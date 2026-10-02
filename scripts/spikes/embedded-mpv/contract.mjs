/** Deliberately small experiment-only IPC contract. No path/MPV command from renderer. */
export function validateAction(payload) {
  if (!payload || typeof payload !== "object") throw new Error("invalid-action");
  const { op, value } = payload;
  if (["quit", "next", "fullscreen", "windowed"].includes(op)) return { op };
  if (op === "pause" && typeof value === "boolean") return { op, value };
  const ranges = { seek: [0, 86400], volume: [0, 100], rotate: [0, 270] };
  if (Object.hasOwn(ranges, op) && Number.isFinite(value) && value >= ranges[op][0] && value <= ranges[op][1]
    && (op !== "rotate" || value % 90 === 0)) return { op, value };
  throw new Error("invalid-action");
}
export function validateBounds(value) {
  if (!value || typeof value !== "object" || !["x","y","width","height"].every((key)=>Number.isInteger(value[key]))) throw new Error("invalid-bounds");
  const {x,y,width,height}=value;
  if(x<0||y<0||width<1||height<1||x+width>32768||y+height>32768) throw new Error("invalid-bounds");
  return {op:"bounds",x,y,width,height};
}
