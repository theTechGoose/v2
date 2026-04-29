/**
 * Phone-mockup story isolated from the landing page.
 *
 * The interactive shell + animation + scroll-to-bottom logic lives in
 * `/islands/PhoneChat.tsx` (the same island the live landing uses). The
 * story only contributes the four scripts (en, en-mid, en-empty, es) and
 * flips `controls` on so the Play/Reset/End buttons render.
 */

import type { Story } from "denostories";
import PhoneChat, { type Bubble, type QuoteCopy } from "../islands/PhoneChat.tsx";

const SCRIPT_EN: Bubble[] = [
  { side: "right", kind: "bubble", cls: "me",   text: "Kitchen remodel for the Hernández family. Cabinets, quartz counters, 3 days labor." },
  { side: "right", kind: "meta",   text: "9:38 AM" },
  { side: "left",  kind: "typing" },
  { side: "left",  kind: "bubble", cls: "them", text: "Got it 👍 What zip code is the job in?" },
  { side: "left",  kind: "bubble", cls: "them", text: "And rough square footage of countertop?" },
  { side: "right", kind: "bubble", cls: "me",   text: "78704. About 42 sq ft of counter." },
  { side: "left",  kind: "typing" },
  { side: "left",  kind: "bubble", cls: "them", text: "Perfect. Quote coming up — typical range for this is $10,800–$12,400." },
  { side: "left",  kind: "bubble", cls: "them", text: "Here's your quote, ready to send:", style: "background:var(--mint-200)" },
  { side: "right", kind: "quote" },
  { side: "right", kind: "bubble", cls: "me",   text: "Looks good. Send it to them." },
  { side: "right", kind: "meta",   text: "9:41 AM ✓ Sent to client" },
];

const SCRIPT_ES: Bubble[] = [
  { side: "right", kind: "bubble", cls: "me",   text: "Remodelación cocina para los Hernández. Gabinetes, cubierta de cuarzo, 3 días de mano de obra." },
  { side: "right", kind: "meta",   text: "9:38" },
  { side: "left",  kind: "typing" },
  { side: "left",  kind: "bubble", cls: "them", text: "Listo 👍 ¿Cuál es el código postal del trabajo?" },
  { side: "left",  kind: "bubble", cls: "them", text: "¿Y aproximadamente cuántos pies² de cubierta?" },
  { side: "right", kind: "bubble", cls: "me",   text: "78704. Como 42 pies² de cubierta." },
  { side: "left",  kind: "typing" },
  { side: "left",  kind: "bubble", cls: "them", text: "Perfecto. Va la cotización — rango típico $10.800–$12.400." },
  { side: "left",  kind: "bubble", cls: "them", text: "Aquí está tu cotización, lista para enviar:", style: "background:var(--mint-200)" },
  { side: "right", kind: "quote" },
  { side: "right", kind: "bubble", cls: "me",   text: "Se ve bien. Mándasela." },
  { side: "right", kind: "meta",   text: "9:41 ✓ Enviado al cliente" },
];

const QUOTE_EN: QuoteCopy = { hd: "Quote · #PM-2641", l1: "Cabinets & install", l2: "Quartz countertops", l3: "Demo & labor", total: "Total" };
const QUOTE_ES: QuoteCopy = { hd: "Cotización · #PM-2641", l1: "Gabinetes e instalación", l2: "Cubiertas de cuarzo", l3: "Demolición y mano de obra", total: "Total" };

// `<style @import>` because a bare <link> inside the story body gets
// stripped at SSR. The iMessage scrollbar/animation rules live in
// landing.css now (so the live landing benefits too).
function PhoneStyles() {
  return (
    <style dangerouslySetInnerHTML={{ __html: `
      @import url("/landing.css");
    ` }} />
  );
}

const FRAME = "padding: 24px; background: var(--mint-100, #f6f8f5); min-height: 100vh; display: grid; place-items: center;";

export const Empty: Story = () => (
  <>
    <PhoneStyles />
    <div style={FRAME}>
      <PhoneChat script={[]} quote={QUOTE_EN} lang="en" controls />
    </div>
  </>
);

export const MidConversation: Story = () => (
  <>
    <PhoneStyles />
    <div style={FRAME}>
      <PhoneChat script={SCRIPT_EN.slice(0, 5)} quote={QUOTE_EN} lang="en" controls />
    </div>
  </>
);

export const Full: Story = () => (
  <>
    <PhoneStyles />
    <div style={FRAME}>
      <PhoneChat script={SCRIPT_EN} quote={QUOTE_EN} lang="en" controls />
    </div>
  </>
);

export const Spanish: Story = () => (
  <>
    <PhoneStyles />
    <div style={FRAME}>
      <PhoneChat script={SCRIPT_ES} quote={QUOTE_ES} lang="es" controls />
    </div>
  </>
);
