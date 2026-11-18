/**
 * REQ-929 — Settings: sign out after inactivity. The shared rule (choices, the person's own
 * setting, the timer's phases, the countdown) and the wiring: the Settings card, the app shell's
 * timer island, /login's notice, both dictionaries.
 */
import * as fs from "fs";
import * as path from "path";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const mod = () => require("../../shared/idle-logout/mod");

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;

describe("REQ-929 idle-logout rule", () => {
  it("REQ-929 the choices are Never, 15 min, 30 min, 1 h, 2 h, 4 h; anything else is refused", () => {
    const { IDLE_LOGOUT_CHOICES, isIdleLogoutMinutes } = mod();
    expect([...IDLE_LOGOUT_CHOICES]).toEqual([0, 15, 30, 60, 120, 240]);
    for (const v of [0, 15, 30, 60, 120, 240]) expect(isIdleLogoutMinutes(v)).toBe(true);
    for (const v of [1, -15, 45, "15", null, undefined, 15.5, NaN]) {
      expect(isIdleLogoutMinutes(v)).toBe(false);
    }
  });

  it("REQ-929 the setting is the person's own: hers while acting (never the owner's), unset or bad is Never", () => {
    const { idleMinutesOf } = mod();
    expect(idleMinutesOf(undefined)).toBe(0);
    expect(idleMinutesOf({})).toBe(0);
    expect(idleMinutesOf({ idleLogoutMinutes: 30 })).toBe(30);
    expect(idleMinutesOf({ idleLogoutMinutes: 7 })).toBe(0);
    expect(idleMinutesOf({ idleLogoutMinutes: 30, actor: { idleLogoutMinutes: 60 } })).toBe(60);
    expect(idleMinutesOf({ idleLogoutMinutes: 30, actor: {} })).toBe(0);
  });

  it("REQ-929 the timer: off at 0, active until the last minute, warn in it, expired at the deadline", () => {
    const { idlePhase, IDLE_WARN_MS } = mod();
    const min = 60_000;
    expect(IDLE_WARN_MS).toBe(min);
    expect(idlePhase({ minutes: 0, lastActivity: 0, now: 10 * 60 * min }).phase).toBe("off");
    expect(idlePhase({ minutes: 15, lastActivity: 0, now: 0 })).toEqual({ phase: "active", remainingMs: 15 * min });
    expect(idlePhase({ minutes: 15, lastActivity: 0, now: 14 * min - 1 }).phase).toBe("active");
    expect(idlePhase({ minutes: 15, lastActivity: 0, now: 14 * min })).toEqual({ phase: "warn", remainingMs: min });
    expect(idlePhase({ minutes: 15, lastActivity: 0, now: 15 * min - 1 }).phase).toBe("warn");
    expect(idlePhase({ minutes: 15, lastActivity: 0, now: 15 * min })).toEqual({ phase: "expired", remainingMs: 0 });
    // a clock that went backwards (or activity "in the future" from another tab) is never expired
    expect(idlePhase({ minutes: 15, lastActivity: 5 * min, now: 0 }).phase).toBe("active");
  });

  it("REQ-929 the countdown reads m:ss, never negative", () => {
    const { fmtCountdown } = mod();
    expect(fmtCountdown(60_000)).toBe("1:00");
    expect(fmtCountdown(59_001)).toBe("1:00");
    expect(fmtCountdown(59_000)).toBe("0:59");
    expect(fmtCountdown(5_000)).toBe("0:05");
    expect(fmtCountdown(-3)).toBe("0:00");
  });

  it("REQ-929 the last-activity stamp other tabs share reads back only as a finite number", () => {
    const { parseLastActivity, IDLE_LAST_KEY } = mod();
    expect(IDLE_LAST_KEY).toBe("pm:idle-last");
    expect(parseLastActivity("1700000000000")).toBe(1700000000000);
    expect(parseLastActivity(null)).toBeNull();
    expect(parseLastActivity("nope")).toBeNull();
  });
});

describe("REQ-929 wiring", () => {
  it("REQ-929 Settings has a Security card whose select saves idleLogoutMinutes through PUT /me", () => {
    const src = read("front-end/islands/SettingsPage.tsx");
    expect(src).toContain("IdleLogoutCard");
    expect(src).toContain('data-cy="settings-idle-logout"');
    expect(src).toMatch(/idleLogoutMinutes/);
    expect(src).toContain("IDLE_LOGOUT_CHOICES");
  });

  it("REQ-929 the app shell mounts the timer on signed-in pages with the person's own minutes", () => {
    const src = read("front-end/routes/_app.tsx");
    expect(src).toContain("IdleLogout");
    expect(src).toContain("idleMinutesOf(ctx.state.user)");
    const island = read("front-end/islands/IdleLogout.tsx");
    expect(island).toContain('"pm:logout"');
    expect(island).toContain("/api/auth/logout");
    expect(island).toContain("/login?idle=1");
    expect(island).toContain("IDLE_LAST_KEY");
    expect(island).toContain('"storage"');
  });

  it("REQ-929 /login says why when it is reached by the timer", () => {
    expect(read("front-end/routes/login.tsx")).toContain("loginPage.idleSignedOut");
  });

  it("REQ-929 both dictionaries carry every key", () => {
    const keys = [
      "settings.security",
      "settings.idleLogout",
      "settings.idleLogoutHint",
      "settings.idleNever",
      "settings.idleMinutes",
      "settings.idleHours",
      "settings.idleHour",
      "idleLogout.warning",
      "idleLogout.stay",
      "loginPage.idleSignedOut",
    ];
    for (const k of keys) {
      expect(en[k]).toBeTruthy();
      expect(es[k]).toBeTruthy();
    }
    expect(en["idleLogout.warning"]).toContain("{time}");
    expect(es["idleLogout.warning"]).toContain("{time}");
  });
});
