/**
 * Server-rendered Assistant page chrome — ported verbatim from
 * Paperwork Monster Assistant.html. The DocPane tabs and Composer textarea
 * become islands; everything else is static SSR.
 */
import { I, ICN } from "../lib/dash-icons.tsx";
import { type Lang, tFor } from "../lib/i18n.ts";

/* ---------- Voice memo ---------- */

export function Voice(
  { duration = "0:14", played = 0.6, lang = "en" }: {
    duration?: string;
    played?: number;
    lang?: Lang;
  },
) {
  const bars = Array.from(
    { length: 26 },
    (_, i) => 4 + Math.abs(Math.sin(i * 1.7)) * 14,
  );
  const playedIdx = Math.floor(bars.length * played);
  return (
    <div class="voice">
      <button
        type="button"
        class="voice__play"
        aria-label={tFor(lang, "assistantDemo.voice.play")}
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
          <path d="M8 5v14l11-7z" />
        </svg>
      </button>
      <div class="voice__wave">
        {bars.map((h, i) => (
          <div
            key={i}
            class={`voice__bar ${i < playedIdx ? "voice__bar--played" : ""}`}
            style={`height:${h}px`}
          />
        ))}
      </div>
      <span class="voice__time">{duration}</span>
    </div>
  );
}

/* ---------- Chat header ---------- */

export function ChatHeader(
  { client, status, lang = "en" }: {
    client: string;
    status: string;
    lang?: Lang;
  },
) {
  return (
    <div class="chat__head">
      <a
        href="/dashboard"
        class="chat__head-btn"
        title={tFor(lang, "assistantDemo.chatHeader.backToDashboard")}
        style="text-decoration:none"
      >
        <I d={ICN.back} size={15} />
      </a>
      <div class="chat__head-info">
        <div class="chat__head-title">{client}</div>
        <div class="chat__head-sub">
          <span class="chat__head-dot" />
          {status}
        </div>
      </div>
      <div class="chat__head-tools">
        <button
          type="button"
          class="chat__head-btn"
          title={tFor(lang, "assistantDemo.chatHeader.shareThread")}
        >
          <I d={ICN.send} size={15} />
        </button>
        <button
          type="button"
          class="chat__head-btn"
          title={tFor(lang, "assistantDemo.chatHeader.more")}
        >
          <I d={ICN.more} size={15} />
        </button>
      </div>
    </div>
  );
}

/* ---------- DealBar ---------- */

export function DealBar(
  { client, total, phase, lang = "en" }: {
    client: string;
    total: string;
    phase: 1 | 2 | 3;
    lang?: Lang;
  },
) {
  return (
    <div class="deal">
      <div class="deal__client">
        <span class="deal__client-label">
          {tFor(lang, "assistantDemo.dealBar.client")}
        </span>
        <span class="deal__client-name">{client}</span>
      </div>
      <div class="deal__total">
        <span class="deal__total-label">
          {tFor(lang, "assistantDemo.dealBar.quoteTotal")}
        </span>
        <span class="deal__total-val">{total}</span>
      </div>
      <div class="deal__phases">
        <span
          class={`deal__phase ${
            phase > 1
              ? "deal__phase--done"
              : phase === 1
              ? "deal__phase--active"
              : ""
          }`}
        >
          <span class="deal__phase-num">
            {phase > 1 ? <I d={ICN.check} size={9} sw={3.5} /> : "1"}
          </span>
          {tFor(lang, "assistantDemo.dealBar.phaseQuote")}
        </span>
        <span class="deal__phase-arrow">→</span>
        <span
          class={`deal__phase ${
            phase > 2
              ? "deal__phase--done"
              : phase === 2
              ? "deal__phase--active"
              : ""
          }`}
        >
          <span class="deal__phase-num">
            {phase > 2 ? <I d={ICN.check} size={9} sw={3.5} /> : "2"}
          </span>
          {tFor(lang, "assistantDemo.dealBar.phaseTerms")}
        </span>
        <span class="deal__phase-arrow">→</span>
        <span class={`deal__phase ${phase === 3 ? "deal__phase--active" : ""}`}>
          <span class="deal__phase-num">3</span>
          {tFor(lang, "assistantDemo.dealBar.phaseSend")}
        </span>
      </div>
      <button type="button" class="deal__back">
        <I d={ICN.back} size={11} />{" "}
        {tFor(lang, "assistantDemo.dealBar.backToChat")}
      </button>
    </div>
  );
}

/* ---------- ChatScroll (static seed for v1) ---------- */

export function ChatScroll({ lang = "en" }: { lang?: Lang } = {}) {
  return (
    <div class="chat__scroll">
      <DealBar
        client={tFor(lang, "assistantDemo.client")}
        total="$3,400"
        phase={2}
        lang={lang}
      />

      <div class="chat__day">{tFor(lang, "assistantDemo.chat.dayDivider")}</div>

      {/* User: voice memo */}
      <div class="msg msg--user">
        <div class="msg__avatar">DR</div>
        <div>
          <Voice duration="0:23" played={0.55} lang={lang} />
          <div class="msg__time">
            {tFor(lang, "assistantDemo.chat.timeTranscribed")}
          </div>
        </div>
      </div>

      {/* Assistant transcribes + asks */}
      <div class="msg">
        <div class="msg__avatar">
          <img src="/logo-monster.png" alt="" />
        </div>
        <div>
          <div class="msg__bubble">
            {tFor(lang, "assistantDemo.chat.gotItPre")}
            <strong>{tFor(lang, "assistantDemo.client")}</strong>
            {tFor(lang, "assistantDemo.chat.gotItMid")}
            "<em>{tFor(lang, "assistantDemo.chat.heardYouSay")}</em>."
            <br />
            <br />
            {tFor(lang, "assistantDemo.chat.beforeDraft")}
            <ul style="margin:8px 0 0;padding-left:18px;line-height:1.6">
              <li>{tFor(lang, "assistantDemo.chat.checkGrind")}</li>
              <li>{tFor(lang, "assistantDemo.chat.checkTopcoat")}</li>
            </ul>
          </div>
          <div class="msg__time">{tFor(lang, "assistantDemo.chat.time842")}</div>
        </div>
      </div>

      {/* User: text + photos */}
      <div class="msg msg--user">
        <div class="msg__avatar">DR</div>
        <div>
          <div class="msg__bubble">
            {tFor(lang, "assistantDemo.chat.userGrind")}
            <div class="msg__photos">
              <div class="msg__photo msg__photo--1">
                <I d={ICN.img} size={20} />
              </div>
              <div class="msg__photo msg__photo--2">
                <I d={ICN.img} size={20} />
              </div>
              <div class="msg__photo msg__photo--3">
                <I d={ICN.img} size={20} />
              </div>
            </div>
          </div>
          <div class="msg__time">{tFor(lang, "assistantDemo.chat.time843")}</div>
        </div>
      </div>

      {/* Assistant action card — quote drafted */}
      <div class="msg">
        <div class="msg__avatar">
          <img src="/logo-monster.png" alt="" />
        </div>
        <div style="flex:1;min-width:0">
          <div class="msg__bubble">
            {tFor(lang, "assistantDemo.chat.onItPre")}
            <strong>{tFor(lang, "assistantDemo.chat.templateName")}</strong>{" "}
            {tFor(lang, "assistantDemo.chat.onItPost")}
          </div>

          <div class="action-card">
            <div class="action-card__head">
              <div class="action-card__icon">
                <I d={ICN.quote} size={16} />
              </div>
              <div style="flex:1;min-width:0">
                <div class="action-card__title">
                  {tFor(lang, "assistantDemo.actionCard.title")}
                </div>
                <div class="action-card__sub">
                  {tFor(lang, "assistantDemo.actionCard.sub")}
                </div>
              </div>
              <span class="action-card__chip">{tFor(lang, "status.draft")}</span>
            </div>
            <div class="action-card__body">
              <div class="action-card__row">
                <span>{tFor(lang, "assistantDemo.actionCard.rowPrep")}</span>
                <strong>$840</strong>
              </div>
              <div class="action-card__row">
                <span>
                  {tFor(lang, "assistantDemo.actionCard.rowSystem")}
                </span>
                <strong>$1,680</strong>
              </div>
              <div class="action-card__row">
                <span>{tFor(lang, "assistantDemo.actionCard.rowFlakes")}</span>
                <strong>$520</strong>
              </div>
              <div class="action-card__row">
                <span>
                  {tFor(lang, "assistantDemo.actionCard.rowMaterials")}
                </span>
                <strong>$360</strong>
              </div>
              <div
                class="action-card__row"
                style="border-top:1px solid rgba(20,72,82,0.08);margin-top:6px;padding-top:8px"
              >
                <span style="font-weight:700;color:var(--brand-teal)">
                  {tFor(lang, "assistantDemo.actionCard.total")}
                </span>
                <strong style="font-size:15px">$3,400</strong>
              </div>
            </div>
          </div>

          <div class="msg__time">
            {tFor(lang, "assistantDemo.chat.time843Draft")}
          </div>
        </div>
      </div>

      {/* User accepts */}
      <div class="msg msg--user">
        <div class="msg__avatar">DR</div>
        <div>
          <div class="msg__bubble">
            {tFor(lang, "assistantDemo.chat.lockItIn")}
          </div>
          <div class="msg__time">{tFor(lang, "assistantDemo.chat.time844")}</div>
        </div>
      </div>

      {/* Continue-to-terms CTA */}
      <div class="msg">
        <div class="msg__avatar">
          <img src="/logo-monster.png" alt="" />
        </div>
        <div style="flex:1;min-width:0">
          <div class="msg__bubble">
            {tFor(lang, "assistantDemo.chat.lockedPre")}
            <strong>$3,400</strong>
            {tFor(lang, "assistantDemo.chat.lockedPost")}
          </div>
          <div class="continue-cta">
            <div class="continue-cta__icon">
              <I d={ICN.contract} size={18} />
            </div>
            <div class="continue-cta__txt">
              <div class="continue-cta__title">
                {tFor(lang, "assistantDemo.continueCta.title")}
              </div>
              <div class="continue-cta__sub">
                {tFor(lang, "assistantDemo.continueCta.sub")}
              </div>
            </div>
            <button type="button" class="continue-cta__btn">
              {tFor(lang, "assistantDemo.continueCta.start")}{" "}
              <I d={ICN.arrow} size={11} sw={2.5} />
            </button>
          </div>
          <div class="msg__time">{tFor(lang, "assistantDemo.chat.time844")}</div>
        </div>
      </div>

      {/* Phase divider */}
      <div class="phase-divider">
        <div class="phase-divider__line" />
        <div class="phase-divider__label">
          <I d={ICN.contract} size={11} />{" "}
          {tFor(lang, "assistantDemo.phaseDivider.contractTerms")}
        </div>
        <div class="phase-divider__line" />
      </div>

      {/* Inline wizard message */}
      <div class="msg">
        <div class="msg__avatar">
          <img src="/logo-monster.png" alt="" />
        </div>
        <div style="flex:1;min-width:0">
          <div class="wiz">
            <div class="wiz__head">
              <div class="wiz__head-icon">
                <I d={ICN.contract} size={16} />
              </div>
              <div class="wiz__head-txt">
                <div class="wiz__head-title">
                  {tFor(lang, "assistantDemo.wiz.title")}
                </div>
                <div class="wiz__head-sub">
                  {tFor(lang, "assistantDemo.wiz.sub")}
                </div>
              </div>
              <div class="wiz__head-config">
                <I d={ICN.bookmark} size={11} />{" "}
                {tFor(lang, "assistantDemo.wiz.standardResidential")}
              </div>
              <button
                type="button"
                class="wiz__head-mode"
                title={tFor(lang, "assistantDemo.wiz.allOnOneTitle")}
              >
                <I d={ICN.list} size={11} />{" "}
                {tFor(lang, "assistantDemo.wiz.allOnOne")}
              </button>
            </div>

            <div class="wiz__chips">
              <span class="wiz-chip">
                <span class="wiz-chip__check">✓</span>
                <span class="wiz-chip__label">
                  {tFor(lang, "assistantDemo.wiz.chipConfig")}
                </span>
                <span class="wiz-chip__val">
                  {tFor(lang, "assistantDemo.wiz.standardResidential")}
                </span>
                <I d={ICN.pencil} size={10} sw={2.4} />
              </span>
              <span class="wiz-chip">
                <span class="wiz-chip__check">✓</span>
                <span class="wiz-chip__label">
                  {tFor(lang, "assistantDemo.wiz.chipCustomer")}
                </span>
                <span class="wiz-chip__val">
                  {tFor(lang, "assistantDemo.client")}
                </span>
                <I d={ICN.pencil} size={10} sw={2.4} />
              </span>
              <span class="wiz-chip">
                <span class="wiz-chip__check">✓</span>
                <span class="wiz-chip__label">
                  {tFor(lang, "assistantDemo.wiz.chipStart")}
                </span>
                <span class="wiz-chip__val">
                  {tFor(lang, "assistantDemo.wiz.startVal")}
                </span>
                <I d={ICN.pencil} size={10} sw={2.4} />
              </span>
              <span class="wiz-chip">
                <span class="wiz-chip__check">✓</span>
                <span class="wiz-chip__label">
                  {tFor(lang, "assistantDemo.wiz.chipWraps")}
                </span>
                <span class="wiz-chip__val">
                  {tFor(lang, "assistantDemo.wiz.wrapsVal")}
                </span>
                <I d={ICN.pencil} size={10} sw={2.4} />
              </span>
            </div>

            <div class="wiz__step">
              <div class="wiz__step-num">
                {tFor(lang, "assistantDemo.wiz.stepNum")}
              </div>
              <h3 class="wiz__step-q">{tFor(lang, "assistantDemo.wiz.stepQ")}</h3>
              <div class="wiz__opts">
                <button type="button" class="wiz-opt">
                  {tFor(lang, "assistantDemo.wiz.optCompletion")}
                  <span class="wiz-opt__sub">
                    {tFor(lang, "assistantDemo.wiz.optCompletionSub")}
                  </span>
                </button>
                <button type="button" class="wiz-opt">
                  {tFor(lang, "assistantDemo.wiz.optHalf")}
                  <span class="wiz-opt__sub">
                    {tFor(lang, "assistantDemo.wiz.optHalfSub")}
                  </span>
                </button>
                <button type="button" class="wiz-opt">
                  {tFor(lang, "assistantDemo.wiz.optThirds")}
                  <span class="wiz-opt__sub">
                    {tFor(lang, "assistantDemo.wiz.optThirdsSub")}
                  </span>
                </button>
                <button type="button" class="wiz-opt">
                  {tFor(lang, "assistantDemo.wiz.optDeposit")}
                  <span class="wiz-opt__sub">
                    {tFor(lang, "assistantDemo.wiz.optDepositSub")}
                  </span>
                </button>
                <button type="button" class="wiz-opt wiz-opt--custom">
                  <I d={ICN.plus} size={11} sw={2.5} />{" "}
                  {tFor(lang, "assistantDemo.wiz.optCustom")}
                  <span class="wiz-opt__sub">
                    {tFor(lang, "assistantDemo.wiz.optCustomSub")}
                  </span>
                </button>
              </div>
            </div>

            <div class="wiz__rest">
              <span class="wiz__rest-label">
                {tFor(lang, "assistantDemo.wiz.upNext")}
              </span>
              <span class="wiz-pill">
                <span class="wiz-pill__num">6</span>{" "}
                {tFor(lang, "assistantDemo.wiz.pillWarranty")}
              </span>
              <span class="wiz-pill">
                <span class="wiz-pill__num">7</span>{" "}
                {tFor(lang, "assistantDemo.wiz.pillTermination")}
              </span>
              <span class="wiz-pill">
                <span class="wiz-pill__num">8</span>{" "}
                {tFor(lang, "assistantDemo.wiz.pillDispute")}
              </span>
              <span class="wiz-pill">
                <span class="wiz-pill__num">9</span>{" "}
                {tFor(lang, "assistantDemo.wiz.pillGoverning")}
              </span>
              <span class="wiz-pill">
                <span class="wiz-pill__num">10</span>{" "}
                {tFor(lang, "assistantDemo.wiz.pillStateNotices")}
              </span>
            </div>

            <div class="wiz__foot">
              <span class="wiz__foot-count">
                {tFor(lang, "assistantDemo.wiz.footCount")}
              </span>
              <div class="wiz__foot-progress">
                <div class="wiz__foot-bar" style="width:40%" />
              </div>
              <button type="button" class="wiz__foot-finalize">
                <I d={ICN.check} size={11} sw={3} />{" "}
                {tFor(lang, "assistantDemo.wiz.finalize")}
              </button>
            </div>
          </div>
          <div class="msg__time">
            {tFor(lang, "assistantDemo.chat.time844Autosave")}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- Suggestions ---------- */

export function Suggestions({ lang = "en" }: { lang?: Lang } = {}) {
  return (
    <div class="suggest">
      <span style="font-size:11px;font-weight:800;letter-spacing:0.06em;color:var(--fg-subtle);text-transform:uppercase;align-self:center;margin-right:4px">
        {tFor(lang, "assistantDemo.suggest.orType")}
      </span>
      <button type="button" class="suggest__chip">
        <I d={ICN.bolt} size={11} />{" "}
        {tFor(lang, "assistantDemo.suggest.net30")}
      </button>
      <button type="button" class="suggest__chip">
        <I d={ICN.refresh} size={11} />{" "}
        {tFor(lang, "assistantDemo.suggest.reopenQuote")}
      </button>
      <button type="button" class="suggest__chip">
        <I d={ICN.bookmark} size={11} />{" "}
        {tFor(lang, "assistantDemo.suggest.useLastContract")}
      </button>
    </div>
  );
}
