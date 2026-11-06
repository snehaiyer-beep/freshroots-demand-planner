"use client";

import { Area, AreaChart, ResponsiveContainer, Tooltip, YAxis } from "recharts";

/** 12-week sales trend: single series, 2px line, hover tooltip, last week marked. */
export function Sparkline({ values, weeks }: { values: number[]; weeks: string[] }) {
  if (values.every((v) => v === 0)) {
    return (
      <div className="flex h-16 w-full items-center justify-center rounded-xl border border-dashed border-slate-200 text-xs text-slate-400">
        No sales yet
      </div>
    );
  }
  const data = values.map((v, i) => ({ week: weeks[i], units: v }));
  const last = data.length - 1;
  return (
    <div className="h-16 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 6, right: 6, bottom: 2, left: 6 }}>
          <defs>
            <linearGradient id="spark" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#047857" stopOpacity={0.18} />
              <stop offset="100%" stopColor="#047857" stopOpacity={0} />
            </linearGradient>
          </defs>
          <YAxis hide domain={[0, "dataMax"]} />
          <Tooltip
            cursor={{ stroke: "#cbd5e1", strokeWidth: 1 }}
            formatter={(v) => [`${Number(v).toLocaleString("en-IN")} units`, "Sold"]}
            labelFormatter={(_, p) => {
              const w = (p?.[0]?.payload as { week?: string } | undefined)?.week;
              return w ? `Week of ${w}` : "";
            }}
            contentStyle={{ fontSize: 12, padding: "4px 8px", borderRadius: 8, border: "1px solid #e2e8f0" }}
          />
          <Area
            type="monotone"
            dataKey="units"
            stroke="#047857"
            strokeWidth={2}
            fill="url(#spark)"
            isAnimationActive={false}
            dot={(props: { cx?: number; cy?: number; index?: number }) =>
              props.index === last ? (
                <circle key="last" cx={props.cx} cy={props.cy} r={4} fill="#047857" stroke="#fff" strokeWidth={2} />
              ) : (
                <g key={props.index} />
              )
            }
            activeDot={{ r: 4, fill: "#047857", stroke: "#fff", strokeWidth: 2 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
