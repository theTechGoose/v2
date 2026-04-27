/* Plain-JS port of CodeInput. Bound to the SSR'd markup at /verify.
   Reads ?phone= from the URL, posts to /api/auth/verify on completion,
   redirects to /dashboard on success, shakes + clears on failure. */
(function () {
  "use strict";
  const lang = (localStorage.getItem("pm:lang") === "es") ? "es" : "en";

  const STR = {
    en: {
      cta: "Verify",
      sending: "…",
      invalid: "That code didn’t match. Try again.",
      expired: "Code expired — request a new one.",
      rate: "Too many tries. Wait a minute and try again.",
      resend: "Resend code",
      resendIn: "Resend in {n}s",
    },
    es: {
      cta: "Verificar",
      sending: "…",
      invalid: "Ese código no coincide. Intenta de nuevo.",
      expired: "El código expiró. Pide uno nuevo.",
      rate: "Demasiados intentos. Espera un minuto.",
      resend: "Reenviar código",
      resendIn: "Reenviar en {n}s",
    },
  };
  const s = STR[lang];

  const params = new URLSearchParams(location.search);
  const phone = params.get("phone");
  const slots = Array.prototype.slice.call(document.querySelectorAll(".code-input input"));
  const codeRoot = document.querySelector(".code-input");
  const ctaBtn = document.querySelector("button.btn.btn-primary.btn-lg");
  const errEl = document.querySelector(".verify-card .error");
  const editLink = document.querySelector(".verify-card .meta a");
  const resendBtn = document.querySelector(".verify-card .meta button");

  if (!slots.length || !phone) return;

  let submitting = false;
  let cooldown = 0;
  let cooldownTimer = null;

  function setError(text) {
    let el = errEl;
    if (!el) {
      el = document.createElement("p");
      el.className = "error";
      el.setAttribute("role", "alert");
      codeRoot.parentNode.insertBefore(el, codeRoot.nextSibling);
    }
    el.textContent = text;
  }
  function clearError() {
    const el = document.querySelector(".verify-card .error");
    if (el) el.remove();
  }
  function shake() {
    codeRoot.classList.add("shake");
    setTimeout(function () { codeRoot.classList.remove("shake"); }, 380);
  }

  function setSlot(i, val) {
    const v = (val || "").replace(/\D/g, "").slice(-1);
    slots[i].value = v;
    if (v && i < slots.length - 1) slots[i + 1].focus();
    if (v && i === slots.length - 1) submit();
    refreshCta();
  }

  function refreshCta() {
    if (!ctaBtn) return;
    const code = slots.map(function (s) { return s.value; }).join("");
    ctaBtn.disabled = submitting || code.length !== slots.length;
  }

  async function submit() {
    if (submitting) return;
    const code = slots.map(function (s) { return s.value; }).join("");
    if (code.length !== slots.length) return;
    submitting = true;
    refreshCta();
    if (ctaBtn) ctaBtn.textContent = s.sending;
    clearError();
    try {
      const r = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phoneNumber: phone, code }),
        credentials: "include",
      });
      const j = await r.json();
      if (r.ok && j.ok) {
        location.href = j.redirectTo || "/dashboard";
        return;
      }
      const map = { invalid_code: s.invalid, expired: s.expired, rate_limited: s.rate };
      setError(map[j.error] || s.invalid);
      shake();
      slots.forEach(function (sl) { sl.value = ""; });
      slots[0].focus();
    } catch {
      setError(s.invalid);
    } finally {
      submitting = false;
      if (ctaBtn) ctaBtn.textContent = s.cta;
      refreshCta();
    }
  }

  slots.forEach(function (inp, i) {
    inp.addEventListener("input", function (e) { setSlot(i, e.target.value); });
    inp.addEventListener("keydown", function (e) {
      if (e.key === "Backspace" && !inp.value && i > 0) slots[i - 1].focus();
    });
    inp.addEventListener("paste", function (e) {
      const pasted = (e.clipboardData ? e.clipboardData.getData("text") : "").replace(/\D/g, "").slice(0, slots.length);
      if (!pasted) return;
      e.preventDefault();
      for (let j = 0; j < slots.length; j++) slots[j].value = pasted[j] || "";
      slots[Math.min(pasted.length, slots.length - 1)].focus();
      refreshCta();
      if (pasted.length === slots.length) submit();
    });
  });

  if (ctaBtn) {
    ctaBtn.textContent = s.cta;
    ctaBtn.addEventListener("click", function () { submit(); });
  }

  function tickCooldown() {
    if (cooldown <= 0) {
      if (resendBtn) {
        resendBtn.disabled = false;
        resendBtn.textContent = s.resend;
      }
      if (cooldownTimer) clearInterval(cooldownTimer);
      cooldownTimer = null;
      return;
    }
    if (resendBtn) resendBtn.textContent = s.resendIn.replace("{n}", String(cooldown));
    cooldown -= 1;
  }

  if (resendBtn) {
    resendBtn.textContent = s.resend;
    resendBtn.addEventListener("click", async function () {
      if (cooldown > 0) return;
      cooldown = 30;
      resendBtn.disabled = true;
      tickCooldown();
      cooldownTimer = setInterval(tickCooldown, 1000);
      try {
        await fetch("/api/auth/send-otp", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ phoneNumber: phone, language: lang }),
        });
      } catch { /* keep cooldown */ }
    });
  }

  slots[0].focus();
  refreshCta();
})();
