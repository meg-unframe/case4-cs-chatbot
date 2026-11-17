import { describe, expect, it } from "vitest";
import { getBusinessHoursStatus } from "@/lib/business-hours";

describe("business hours (JST 10-18, 仮: 月〜金)", () => {
  const at = (iso: string) => getBusinessHoursStatus(new Date(iso));
  it("10:00 は営業時間内、9:59 は外", () => {
    expect(at("2026-11-16T10:00:00+09:00").isOpen).toBe(true);
    expect(at("2026-11-16T09:59:00+09:00").isOpen).toBe(false);
  });
  it("18:00 は営業時間外で翌営業日 10:00", () => {
    const s = at("2026-11-16T18:00:00+09:00");
    expect(s.isOpen).toBe(false);
    expect(s.nextOpenLabel).toBe("11月17日(火) 10:00");
  });
  it("金曜夜・土曜は翌月曜", () => {
    expect(at("2026-11-20T22:00:00+09:00").nextOpenLabel).toBe("11月23日(月) 10:00");
    expect(at("2026-11-21T12:00:00+09:00").nextOpenLabel).toBe("11月23日(月) 10:00");
  });
});
