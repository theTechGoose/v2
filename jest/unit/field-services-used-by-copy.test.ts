/**
 * REQ-1040 (LOOP-007 cycle 2, q2-24) — the /field/services card's "used by" line.
 * QA saw "EN 0 VISITAS PERIÓDICAS · 0 LISTAS DE TAREAS": the Spanish line began with the bare
 * preposition "En", which `.chip`'s `text-transform: uppercase` turned into the "EN" language
 * badge; it called repeat visits "visitas periódicas" while REQ-743 settled on "visitas
 * repetidas"; and a count of 1 still read "1 repeat visits · 1 checklists" (plain t(), no plural).
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;
const page = read("front-end/islands/FieldServicesPage.tsx");
const css = read("front-end/static/field.css");

/** the JSX element carrying data-cy="svc-used-by", from its opening tag to its close */
function usedBySpan(): { open: string; body: string } {
  const at = page.indexOf('data-cy="svc-used-by"');
  if (at < 0) throw new Error('FieldServicesPage.tsx has no data-cy="svc-used-by"');
  const start = page.lastIndexOf("<", at);
  const tag = page.slice(start + 1).match(/^[a-z]+/)![0];
  const openEnd = page.indexOf(">", at);
  const close = page.indexOf(`</${tag}>`, openEnd);
  return {
    open: page.slice(start, openEnd + 1),
    body: page.slice(openEnd + 1, close),
  };
}

describe("REQ-1040 (LOOP-007 q2-24) the Services 'used by' line", () => {
  test("REQ-1040: no field.svc.* Spanish string says 'visita(s) periódica(s)' — REQ-743 calls them 'visitas repetidas'", () => {
    const drift = Object.entries(es)
      .filter(([k, v]) => k.startsWith("field.svc.") && /peri[óo]dica/i.test(v))
      .map(([k, v]) => `${k}: ${v}`);
    expect(drift).toEqual([]);
  });

  test("REQ-1040: the Spanish used-by copy never leads with the bare preposition 'En' (uppercased it reads as the EN badge)", () => {
    const bad = Object.entries(es)
      .filter(([k, v]) => k.startsWith("field.svc.usedBy") && /^\s*En\b/.test(v))
      .map(([k, v]) => `${k}: ${v}`);
    expect(bad).toEqual([]);
  });

  test("REQ-1040: the used-by counts go through .one/.other plural keys, not one flat '{subs} … {ckls}' template (en + es)", () => {
    for (const [lang, dict] of [["en", en], ["es", es]] as const) {
      const flat = Object.entries(dict)
        .filter(([k, v]) => k.startsWith("field.svc.usedBy") && /\{(subs|ckls)\}/.test(v))
        .map(([k, v]) => `${lang} ${k}: ${v}`);
      expect(flat).toEqual([]);
    }
  });

  test("REQ-1040: FieldServicesPage builds the used-by line with tn() for each count, not t('field.svc.usedBy', …)", () => {
    const { body } = usedBySpan();
    expect(body).not.toMatch(/\bt\(\s*["'`]field\.svc\.usedBy["'`]/);
    const tnCalls = body.match(/\btn\(/g) ?? [];
    // one plural choice for the repeat-visit count and one for the checklist count
    // (or a helper that makes them — then that helper must call tn() twice)
    if (tnCalls.length < 2) {
      const helper = body.match(/\{\s*([A-Za-z_]\w*)\(/)?.[1];
      expect(helper).toBeDefined();
      const def = page.slice(page.search(new RegExp(`function ${helper}\\b|const ${helper}\\s*=`)));
      const fnBody = def.slice(0, def.indexOf("\n}") + 2);
      expect((fnBody.match(/\btn\(/g) ?? []).length).toBeGreaterThanOrEqual(1);
      expect(fnBody).toMatch(/usedBy|subs|ckls|subscriptions|checklists/);
    } else {
      expect(tnCalls.length).toBeGreaterThanOrEqual(2);
    }
  });

  test("REQ-1040: the used-by sentence is not shown in a bare uppercase .chip", () => {
    const { open } = usedBySpan();
    const cls = (open.match(/class="([^"]*)"/)?.[1] ?? "").split(/\s+/).filter(Boolean);
    if (!cls.includes("chip")) return; // not a chip: no uppercase
    const modifiers = cls.filter((c) => c !== "chip");
    const plain = modifiers.some((m) => {
      const rule = css.match(new RegExp(`\\.${m.replace(/-/g, "\\-")}\\s*\\{([^}]*)\\}`));
      return !!rule && /text-transform\s*:\s*none/.test(rule[1]);
    });
    expect([cls.join(" "), plain]).toEqual([cls.join(" "), true]);
  });
});
