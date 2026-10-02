"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type Paged, type Row } from "@/lib/api";
import { ResourcePage, type ResourceConfig } from "@/components/data";
import { Badge, Tabs } from "@/components/ui";

const all = (kind: string) => ({
  queryKey: [`/api/locations/${kind}`, { page_size: 0 }],
  queryFn: () => api.get<Paged<Row>>(`/api/locations/${kind}`, { page_size: 0 }),
  staleTime: 60_000,
});
const active = { key: "is_active", label: "Active", type: "checkbox" as const, default: true, placeholder: "Active" };
const activeCol = { key: "is_active", label: "Status", render: (r: Row) => <Badge tone={r.is_active ? "green" : "slate"}>{r.is_active ? "Active" : "Inactive"}</Badge> };
const muted = <span className="text-slate-300">—</span>;

export default function LocationsPage() {
  const [tab, setTab] = useState("countries");
  const countries = useQuery(all("countries"));
  const states = useQuery(all("states"));
  const cities = useQuery(all("cities"));

  const cfg = useMemo<ResourceConfig>(() => {
    const cMap = Object.fromEntries((countries.data?.items || []).map((c) => [c.id, c]));
    const sMap = Object.fromEntries((states.data?.items || []).map((s) => [s.id, s]));
    const ciMap = Object.fromEntries((cities.data?.items || []).map((c) => [c.id, c]));
    const cOpts = (countries.data?.items || []).map((c) => ({ value: c.id, label: c.name }));
    const sOpts = (states.data?.items || []).map((s) => ({ value: s.id, label: `${s.name}${cMap[s.country_id] ? ` (${cMap[s.country_id].name})` : ""}` }));
    const ciOpts = (cities.data?.items || []).map((c) => ({ value: c.id, label: `${c.name}${sMap[c.state_id] ? ` (${sMap[c.state_id].name})` : ""}` }));
    const base = { module: "locations", defaultSort: "name", subtitle: "Countries, states, cities and micro-markets used across leads and projects" };
    switch (tab) {
      case "states":
        return {
          ...base, title: "States", noun: "State", endpoint: "/api/locations/states", searchPlaceholder: "Search states…",
          columns: [
            { key: "name", label: "State", sortable: true, render: (r) => <span className="font-medium">{r.name}</span> },
            { key: "country_id", label: "Country", render: (r) => cMap[r.country_id]?.name || muted },
            activeCol,
          ],
          filters: [{ key: "country_id", label: "All countries", options: cOpts }],
          fields: [
            { key: "country_id", label: "Country", type: "select", options: cOpts, required: true },
            { key: "name", label: "Name", required: true }, active,
          ],
        };
      case "cities":
        return {
          ...base, title: "Cities", noun: "City", endpoint: "/api/locations/cities", searchPlaceholder: "Search cities…",
          columns: [
            { key: "name", label: "City", sortable: true, render: (r) => <span className="font-medium">{r.name}</span> },
            { key: "state_id", label: "State", render: (r) => sMap[r.state_id]?.name || muted },
            { key: "country", label: "Country", render: (r) => cMap[sMap[r.state_id]?.country_id]?.name || muted },
            activeCol,
          ],
          filters: [{ key: "state_id", label: "All states", options: sOpts }],
          fields: [
            { key: "state_id", label: "State", type: "select", options: sOpts, required: true },
            { key: "name", label: "Name", required: true }, active,
          ],
        };
      case "areas":
        return {
          ...base, title: "Areas", noun: "Area", endpoint: "/api/locations/areas", searchPlaceholder: "Search area, pincode, tag…",
          columns: [
            { key: "name", label: "Area", sortable: true, render: (r) => <span className="font-medium">{r.name}</span> },
            { key: "city_id", label: "City", render: (r) => ciMap[r.city_id] ? <>{ciMap[r.city_id].name}<span className="text-xs text-muted"> · {sMap[ciMap[r.city_id].state_id]?.name}</span></> : muted },
            { key: "pincode", label: "Pincode", sortable: true },
            { key: "coords", label: "Lat / Long", render: (r) => r.latitude != null && r.longitude != null
              ? <a className="text-xs text-primary hover:underline" target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
                href={`https://maps.google.com/?q=${r.latitude},${r.longitude}`}>{Number(r.latitude).toFixed(4)}, {Number(r.longitude).toFixed(4)}</a> : muted },
            { key: "tags", label: "Tags", render: (r) => r.tags ? (
              <div className="flex max-w-xs flex-wrap gap-1">{String(r.tags).split(",").map((t) => t.trim()).filter(Boolean).map((t) => <Badge key={t}>{t}</Badge>)}</div>
            ) : muted },
            activeCol,
          ],
          filters: [{ key: "city_id", label: "All cities", options: ciOpts }],
          fields: [
            { key: "city_id", label: "City", type: "select", options: ciOpts, required: true },
            { key: "name", label: "Name", required: true },
            { key: "pincode", label: "Pincode" },
            { key: "tags", label: "Tags", hint: "Comma separated, e.g. Golf Course Road, Sector 54", placeholder: "Golf Course Road" },
            { key: "latitude", label: "Latitude", type: "number" },
            { key: "longitude", label: "Longitude", type: "number" },
            active,
          ],
        };
      default:
        return {
          ...base, title: "Countries", noun: "Country", endpoint: "/api/locations/countries", searchPlaceholder: "Search countries…",
          columns: [
            { key: "name", label: "Country", sortable: true, render: (r) => <span className="font-medium">{r.name}</span> },
            { key: "iso_code", label: "ISO code", sortable: true },
            { key: "states", label: "States", render: (r) => (states.data?.items || []).filter((s) => s.country_id === r.id).length },
            activeCol,
          ],
          fields: [{ key: "name", label: "Name", required: true }, { key: "iso_code", label: "ISO code", placeholder: "IN" }, active],
        };
    }
  }, [tab, countries.data, states.data, cities.data]);

  return (
    <div>
      <Tabs className="mb-4" value={tab} onChange={setTab} tabs={[
        { value: "countries", label: "Countries", count: countries.data?.total },
        { value: "states", label: "States", count: states.data?.total },
        { value: "cities", label: "Cities", count: cities.data?.total },
        { value: "areas", label: "Areas" },
      ]} />
      <ResourcePage key={tab} cfg={cfg} />
    </div>
  );
}
