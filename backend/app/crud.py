"""Generic, permission-aware CRUD router factory.

List endpoints accept:
  q=<text>            search across `search` columns
  <column>=<value>    exact filter on any real column (comma-separated -> IN)
  <column>__gte / __lte / __like
  sort=<col> | -<col>, page, page_size (page_size=0 -> no paging, max 1000)
"""
from typing import Any, Callable

from fastapi import APIRouter, Body, Depends, HTTPException, Request
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from .db import M, clean_payload, get_db, parse_dt, to_dict, utcnow
from .security import Ctx, ensure_access, require, resolve_company_id, scope_filter
from .services.core import assign_code, audit, diff

LIST_HANDLERS: dict = {}  # "/api/clients" -> list endpoint (used by exports)

RESERVED = {"q", "sort", "page", "page_size", "include_inactive", "include_deleted", "for_company"}


def build_list_query(db: Session, ctx: Ctx, model, module: str, params: dict, *, search=(), owner_cols=(),
                     global_rows=False, company_scoped=True):
    cols = model.__table__.columns
    stmt = select(model)
    if "deleted_at" in cols and params.get("include_deleted") != "1":
        stmt = stmt.where(model.deleted_at.is_(None))
    if global_rows:
        if not ctx.is_global and ctx.company_id is not None:
            stmt = stmt.where(or_(model.company_id.is_(None), model.company_id == ctx.company_id))
        elif params.get("for_company"):  # global admin viewing one company: its rows + system rows
            stmt = stmt.where(or_(model.company_id.is_(None), model.company_id == int(params["for_company"])))
    elif company_scoped:
        stmt = scope_filter(stmt, model, db, ctx, module, "view", owner_cols)
    q = (params.get("q") or "").strip()
    if q and search:
        like = f"%{q}%"
        stmt = stmt.where(or_(*[getattr(model, c).like(like) for c in search if c in cols]))
    for key, raw in params.items():
        if key in RESERVED or raw in (None, ""):
            continue
        col, _, op = key.partition("__")
        if col not in cols:
            continue
        c = getattr(model, col)
        t = str(cols[col].type).upper()
        is_dt = "DATETIME" in t or "TIMESTAMP" in t
        val: Any = raw
        if op == "gte":
            stmt = stmt.where(c >= (parse_dt(raw) if is_dt else raw))
        elif op == "lte":
            stmt = stmt.where(c <= (parse_dt(raw) if is_dt else raw))
        elif op == "like":
            stmt = stmt.where(c.like(f"%{raw}%"))
        elif op == "isnull":
            stmt = stmt.where(c.is_(None) if raw in ("1", "true") else c.is_not(None))
        elif "," in str(raw):
            stmt = stmt.where(c.in_([v for v in str(raw).split(",") if v != ""]))
        else:
            if t.startswith(("BOOL", "TINYINT")):
                val = raw in ("1", "true", "True")
            stmt = stmt.where(c == val)
    return stmt


def paginate(db: Session, stmt, model, params: dict, default_sort: str = "-id"):
    cols = model.__table__.columns
    sort = params.get("sort") or default_sort
    desc = sort.startswith("-")
    sc = sort.lstrip("-")
    if sc in cols:
        col = getattr(model, sc)
        stmt = stmt.order_by(col.desc() if desc else col.asc(), model.id.desc())
    total = db.scalar(select(func.count()).select_from(stmt.order_by(None).subquery()))
    page = max(int(params.get("page") or 1), 1)
    size = int(params.get("page_size") or 25)
    size = 1000 if size <= 0 else min(size, 1000)
    rows = list(db.scalars(stmt.offset((page - 1) * size).limit(size)))
    return rows, {"total": total, "page": page, "page_size": size, "pages": (total + size - 1) // size}


def crud_router(*, model: str, module: str, prefix: str, search: tuple = ("name",), owner_cols: tuple = (),
                global_rows: bool = False, company_scoped: bool = True, code_prefix: str | None = None,
                default_sort: str = "-id", enrich: Callable | None = None,
                before_save: Callable | None = None, after_save: Callable | None = None,
                hard_delete: bool = False, required: tuple = (), write_action: str | None = None,
                view_module: str | None = None) -> APIRouter:
    r = APIRouter(prefix=prefix, tags=[module])

    def W(action: str):
        return require(module, write_action or action)

    vm = view_module or module

    def Model():
        return getattr(M, model)

    def _out(db, rows, ctx):
        items = [to_dict(x) for x in rows]
        if enrich:
            enrich(db, items, ctx)
        return items

    def _get(db, ctx, id_: int, action: str):
        mdl = Model()
        row = db.get(mdl, id_)
        if row is None or getattr(row, "deleted_at", None):
            raise HTTPException(404, "Record not found")
        if global_rows:
            if action != "view" and row.company_id is None and not ctx.is_global:
                raise HTTPException(403, "System records can only be changed by a CRM admin")
            if row.company_id not in (None, ctx.company_id) and not ctx.is_global:
                raise HTTPException(404, "Record not found")
            return row
        if company_scoped:
            ensure_access(db, ctx, row, module, write_action if (write_action and action != "view") else action,
                          owner_cols)
        return row

    @r.get("")
    def list_(request: Request, db: Session = Depends(get_db), ctx: Ctx = Depends(require(vm, "view"))):
        params = dict(request.query_params)
        mdl = Model()
        stmt = build_list_query(db, ctx, mdl, module, params, search=search, owner_cols=owner_cols,
                                global_rows=global_rows, company_scoped=company_scoped)
        rows, meta = paginate(db, stmt, mdl, params, default_sort)
        return {"items": _out(db, rows, ctx), **meta}

    LIST_HANDLERS[prefix] = list_

    @r.get("/{id_}")
    def get_(id_: int, db: Session = Depends(get_db), ctx: Ctx = Depends(require(vm, "view"))):
        return _out(db, [_get(db, ctx, id_, "view")], ctx)[0]

    @r.post("")
    def create(request: Request, data: dict = Body(...), db: Session = Depends(get_db),
               ctx: Ctx = Depends(W("add"))):
        mdl = Model()
        for f in required:
            if data.get(f) in (None, ""):
                raise HTTPException(422, f"{f.replace('_', ' ').capitalize()} is required")
        payload = clean_payload(mdl, data)
        cols = mdl.__table__.columns
        if "company_id" in cols and not ctx.is_global:
            payload["company_id"] = ctx.company_id  # non-global users are always pinned to their company
        if "created_by" in cols:
            payload["created_by"] = ctx.id
        if code_prefix and "code" in cols and not payload.get("code"):
            payload["code"] = f"TMP-{utcnow().timestamp()}"
        if before_save:  # may derive company_id from a linked lead/client/project
            before_save(db, ctx, None, payload)
        if "company_id" in cols:
            if global_rows:
                payload["company_id"] = payload.get("company_id") if ctx.is_global else ctx.company_id
            else:
                payload["company_id"] = resolve_company_id(ctx, payload.get("company_id"))
        obj = mdl(**payload)
        db.add(obj)
        db.flush()
        if code_prefix and str(obj.code).startswith("TMP-"):
            assign_code(obj, code_prefix)
        if after_save:
            after_save(db, ctx, obj, True)
        audit(db, ctx, "create", module, obj.id, getattr(obj, "name", None) or getattr(obj, "title", "") or "",
              company_id=getattr(obj, "company_id", None), request=request)
        db.commit()
        db.refresh(obj)
        return _out(db, [obj], ctx)[0]

    @r.patch("/{id_}")
    def update(id_: int, request: Request, data: dict = Body(...), db: Session = Depends(get_db),
               ctx: Ctx = Depends(W("edit"))):
        mdl = Model()
        obj = _get(db, ctx, id_, "edit")
        payload = clean_payload(mdl, data, exclude={"company_id", "created_by"} if not ctx.is_global else {"created_by"})
        if before_save:
            before_save(db, ctx, obj, payload)
        changes = diff(obj, payload)
        for k, v in payload.items():
            setattr(obj, k, v)
        if "updated_by" in mdl.__table__.columns:
            obj.updated_by = ctx.id
        if after_save:
            after_save(db, ctx, obj, False)
        if changes:
            audit(db, ctx, "update", module, obj.id, f"Updated {', '.join(changes)}"[:500], changes,
                  company_id=getattr(obj, "company_id", None), request=request)
        db.commit()
        db.refresh(obj)
        return _out(db, [obj], ctx)[0]

    @r.delete("/{id_}")
    def delete(id_: int, request: Request, db: Session = Depends(get_db),
               ctx: Ctx = Depends(W("delete"))):
        mdl = Model()
        obj = _get(db, ctx, id_, "delete")
        if "deleted_at" in mdl.__table__.columns and not hard_delete:
            obj.deleted_at = utcnow()
        else:
            db.delete(obj)
        audit(db, ctx, "delete", module, id_, getattr(obj, "name", None) or getattr(obj, "title", "") or "",
              company_id=getattr(obj, "company_id", None), request=request)
        db.commit()
        return {"ok": True}

    @r.post("/bulk-delete")
    def bulk_delete(request: Request, ids: list[int] = Body(..., embed=True), db: Session = Depends(get_db),
                    ctx: Ctx = Depends(W("delete"))):
        n = 0
        for i in ids:
            try:
                obj = _get(db, ctx, i, "delete")
            except HTTPException:
                continue
            if "deleted_at" in Model().__table__.columns and not hard_delete:
                obj.deleted_at = utcnow()
            else:
                db.delete(obj)
            n += 1
        audit(db, ctx, "bulk_delete", module, None, f"Deleted {n} records", {"ids": ids}, request=request)
        db.commit()
        return {"deleted": n}

    return r
