/**
 * REQ-920a/c — texting registration (A2P 10DLC) for a customer's line, the
 * ISV path, on the line's own subaccount:
 *
 *   secondary customer profile (business + representative end users, the
 *   address as a supporting document, the platform's ISV primary profile) →
 *   evaluate → submit; A2P trust product (messaging-profile end user + the
 *   profile) → evaluate → submit; brand; messaging service + the number;
 *   and, once the brand is APPROVED, the campaign.
 *
 * Every step is saved the moment it is done, so a refusal (or a primary
 * profile that is not ISV-type yet) leaves the walk resumable: the next
 * `start` or `refresh` carries on from the first missing SID and never makes
 * anything twice. `refresh` also reads Twilio's statuses (profile, trust
 * product, brand, campaign).
 */
import { Injectable } from "#danet/core";
import type {
  A2pError,
  A2pForm,
  A2pRegistration,
  A2pStep,
} from "@communications/dto/mod.ts";
import {
  CommsConfigSource,
  publicUrl,
  ROUTES,
} from "@communications/domain/data/config/mod.ts";
import {
  A2P_POLICY,
  addressFields,
  businessAttributes,
  campaignFields,
  evaluationErrors,
  messagingProfileAttributes,
  reduceA2pState,
  representativeAttributes,
} from "@communications/domain/business/a2p/mod.ts";
import { ownsEnvLine } from "@communications/domain/business/line-resolution/mod.ts";
import {
  type BundleKind,
  type Failure,
  TrustHubClient,
  type TwilioAuth,
} from "@communications/domain/data/trusthub-client/mod.ts";
import { A2pStore } from "@communications/domain/data/a2p-store/mod.ts";
import { LineStore } from "@communications/domain/data/line-store/mod.ts";
import { NoLineError } from "@communications/domain/coordinators/line-context/mod.ts";
import type { Line } from "@communications/dto/mod.ts";

/** the platform's own (env) line is registered through the house path (REQ-920b), not this one */
export class A2pHouseLineError extends Error {
  readonly status: number = 409;
  readonly code = "a2p_house_line";
  constructor() {
    super(
      "this is the platform's own line: it texts under the platform's registration",
    );
    this.name = "A2pHouseLineError";
  }
}

const ISV_IDENTITY = "isv_reseller_or_partner";
const BUSINESS_INFO = "customer_profile_business_information";

interface Walk {
  reg: A2pRegistration;
  auth: TwilioAuth;
  line: Line;
}

@Injectable()
export class A2pRegistrations {
  constructor(
    private trusthub: TrustHubClient,
    private store: A2pStore,
    private lines: LineStore,
    private cfgSource: CommsConfigSource,
  ) {}

  /** the user's line's registration, as last saved (null: never started, or no line) */
  async get(userId: string): Promise<A2pRegistration | null> {
    if (ownsEnvLine(userId, this.cfgSource.get())) return null;
    const line = await this.lines.findActiveByUser(userId);
    return line ? await this.store.get(line.id) : null;
  }

  /** save the form and walk as far as Twilio lets us */
  async start(userId: string, form: A2pForm): Promise<A2pRegistration> {
    const { line, auth } = await this.lineFor(userId);
    const now = new Date().toISOString();
    const prev = await this.store.get(line.id);
    const reg: A2pRegistration = prev ? { ...prev, form, errors: [] } : {
      lineId: line.id,
      userId,
      subaccountSid: line.subaccountSid,
      form,
      assigned: [],
      state: "none",
      errors: [],
      createdAt: now,
      updatedAt: now,
    };
    const w: Walk = { reg, auth, line };
    // a corrected form reaches Twilio while the profile is still a draft
    if (
      prev && !prev.profileSubmitted &&
      JSON.stringify(prev.form) !== JSON.stringify(form)
    ) {
      if (!(await this.updateEndUsers(w))) return await this.finish(w);
    }
    await this.save(w);
    await this.walk(w);
    return await this.finish(w);
  }

  /** read Twilio's statuses, then carry the walk on (the campaign is filed once the brand is APPROVED) */
  async refresh(userId: string): Promise<A2pRegistration | null> {
    const { line, auth } = await this.lineFor(userId);
    const reg = await this.store.get(line.id);
    if (!reg) return null;
    const w: Walk = { reg: { ...reg, errors: [] }, auth, line };
    await this.poll(w);
    await this.walk(w);
    return await this.finish(w);
  }

  // ── the walk ───────────────────────────────────────────────────────────────

  private async walk(w: Walk): Promise<void> {
    const { reg, auth, line } = w;
    const cfg = this.cfgSource.get();
    const f = reg.form;
    const callback = cfg.publicUrl
      ? publicUrl(cfg, ROUTES.a2pStatus)
      : undefined;
    const label = `${f.legalName} (documonster:${reg.userId})`;

    // 1. the secondary customer profile
    if (!reg.profileSid) {
      const r = await this.trusthub.createBundle(auth, "CustomerProfiles", {
        friendlyName: label,
        email: cfg.a2pEmail,
        policySid: A2P_POLICY.customerProfile,
        statusCallback: callback,
      });
      if (!r.ok) return await this.fail(w, "profile", r);
      reg.profileSid = r.sid;
      reg.profileStatus = r.status || "draft";
      await this.save(w);
    }
    const profile = reg.profileSid;

    // 2. the business
    if (!reg.businessEndUserSid) {
      const r = await this.trusthub.createEndUser(auth, {
        friendlyName: `${label} business`,
        type: BUSINESS_INFO,
        attributes: businessAttributes(f),
      });
      if (!r.ok) return await this.fail(w, "profile", r);
      reg.businessEndUserSid = r.sid;
      await this.save(w);
    }
    if (
      !(await this.assigned(
        w,
        "CustomerProfiles",
        profile,
        reg.businessEndUserSid,
        "profile",
      ))
    ) return;

    // 3. the authorized representative
    if (!reg.repEndUserSid) {
      const r = await this.trusthub.createEndUser(auth, {
        friendlyName: `${label} representative`,
        type: "authorized_representative_1",
        attributes: representativeAttributes(f),
      });
      if (!r.ok) return await this.fail(w, "profile", r);
      reg.repEndUserSid = r.sid;
      await this.save(w);
    }
    if (
      !(await this.assigned(
        w,
        "CustomerProfiles",
        profile,
        reg.repEndUserSid,
        "profile",
      ))
    ) return;

    // 4. the address, as a supporting document
    if (!reg.addressSid) {
      const r = await this.trusthub.createAddress(auth, addressFields(f));
      if (!r.ok) return await this.fail(w, "profile", r);
      reg.addressSid = r.sid;
      await this.save(w);
    }
    if (!reg.addressDocSid) {
      const r = await this.trusthub.createSupportingDocument(auth, {
        friendlyName: `${label} address`,
        type: "customer_profile_address",
        attributes: { address_sids: reg.addressSid },
      });
      if (!r.ok) return await this.fail(w, "profile", r);
      reg.addressDocSid = r.sid;
      await this.save(w);
    }
    if (
      !(await this.assigned(
        w,
        "CustomerProfiles",
        profile,
        reg.addressDocSid,
        "profile",
      ))
    ) return;

    // 5. the platform's ISV primary profile (REQ-920c: none yet → wait here, the form kept)
    if (
      !reg.primaryProfileSid ||
      !reg.assigned.includes(`${profile}:${reg.primaryProfileSid}`)
    ) {
      const primary = await this.primary(w);
      if (primary === undefined) return;
      if (primary === null) {
        reg.needsIsvPrimary = true;
        await this.save(w);
        return;
      }
      reg.needsIsvPrimary = false;
      reg.primaryProfileSid = primary;
      await this.save(w);
      if (
        !(await this.assigned(
          w,
          "CustomerProfiles",
          profile,
          primary,
          "profile",
        ))
      ) return;
    }

    // 6. evaluate, then submit
    if (!reg.profileSubmitted) {
      if (
        !(await this.evaluated(
          w,
          "CustomerProfiles",
          profile,
          A2P_POLICY.customerProfile,
          "profile",
        ))
      ) return;
      const r = await this.trusthub.submit(auth, "CustomerProfiles", profile);
      if (!r.ok) return await this.fail(w, "profile", r);
      reg.profileSubmitted = true;
      reg.profileStatus = r.status;
      await this.save(w);
    }

    // 7. the A2P trust product
    if (!reg.trustProductSid) {
      const r = await this.trusthub.createBundle(auth, "TrustProducts", {
        friendlyName: `${label} A2P`,
        email: cfg.a2pEmail,
        policySid: A2P_POLICY.trustProduct,
        statusCallback: callback,
      });
      if (!r.ok) return await this.fail(w, "trust_product", r);
      reg.trustProductSid = r.sid;
      reg.trustProductStatus = r.status || "draft";
      await this.save(w);
    }
    const tp = reg.trustProductSid;
    if (!reg.messagingEndUserSid) {
      const r = await this.trusthub.createEndUser(auth, {
        friendlyName: `${label} messaging profile`,
        type: "us_a2p_messaging_profile_information",
        attributes: messagingProfileAttributes(f),
      });
      if (!r.ok) return await this.fail(w, "trust_product", r);
      reg.messagingEndUserSid = r.sid;
      await this.save(w);
    }
    if (
      !(await this.assigned(
        w,
        "TrustProducts",
        tp,
        reg.messagingEndUserSid,
        "trust_product",
      ))
    ) return;
    if (
      !(await this.assigned(w, "TrustProducts", tp, profile, "trust_product"))
    ) return;
    if (!reg.trustProductSubmitted) {
      if (
        !(await this.evaluated(
          w,
          "TrustProducts",
          tp,
          A2P_POLICY.trustProduct,
          "trust_product",
        ))
      ) return;
      const r = await this.trusthub.submit(auth, "TrustProducts", tp);
      if (!r.ok) return await this.fail(w, "trust_product", r);
      reg.trustProductSubmitted = true;
      reg.trustProductStatus = r.status;
      await this.save(w);
    }

    // 8. the brand
    if (!reg.brandSid) {
      const r = await this.trusthub.createBrand(auth, {
        customerProfileSid: profile,
        trustProductSid: tp,
      });
      if (!r.ok) return await this.fail(w, "brand", r);
      reg.brandSid = r.sid;
      reg.brandStatus = r.status || "PENDING";
      await this.save(w);
    }

    // 9. the messaging service, and the line's number in it
    if (!reg.serviceSid) {
      const r = await this.trusthub.createService(auth, {
        friendlyName: `documonster:${reg.userId}`,
        ...(cfg.publicUrl
          ? {
            inboundUrl: publicUrl(cfg, ROUTES.sms),
            statusCallback: publicUrl(cfg, ROUTES.smsStatus),
          }
          : {}),
      });
      if (!r.ok) return await this.fail(w, "service", r);
      reg.serviceSid = r.sid;
      await this.save(w);
    }
    if (!reg.numberInService) {
      const r = await this.trusthub.addNumber(
        auth,
        reg.serviceSid,
        line.numberSid,
      );
      if (!r.ok) return await this.fail(w, "service", r);
      reg.numberInService = true;
      await this.save(w);
    }

    // 10. the campaign, once the brand is approved
    if (!reg.campaignSid && reg.brandStatus === "APPROVED") {
      const r = await this.trusthub.createCampaign(
        auth,
        reg.serviceSid,
        campaignFields(f, reg.brandSid),
      );
      if (!r.ok) return await this.fail(w, "campaign", r);
      reg.campaignSid = r.sid;
      reg.campaignStatus = r.status || "PENDING";
      this.noteErrors(w, "campaign", r.status, r.errors);
      await this.save(w);
    }
  }

  /** GET every submitted step's status; a failed one carries Twilio's reasons */
  private async poll(w: Walk): Promise<void> {
    const { reg, auth } = w;
    if (reg.profileSid && reg.profileSubmitted) {
      const r = await this.trusthub.getBundle(
        auth,
        "CustomerProfiles",
        reg.profileSid,
      );
      if (!r.ok) await this.fail(w, "profile", r);
      else {
        reg.profileStatus = r.status;
        if (r.status === "twilio-rejected") {
          for (const e of r.errors) {
            w.reg.errors.push({ step: "profile", ...e });
          }
        }
      }
    }
    if (reg.trustProductSid && reg.trustProductSubmitted) {
      const r = await this.trusthub.getBundle(
        auth,
        "TrustProducts",
        reg.trustProductSid,
      );
      if (!r.ok) await this.fail(w, "trust_product", r);
      else {
        reg.trustProductStatus = r.status;
        if (r.status === "twilio-rejected") {
          for (const e of r.errors) {
            w.reg.errors.push({ step: "trust_product", ...e });
          }
        }
      }
    }
    if (reg.brandSid) {
      const r = await this.trusthub.getBrand(auth, reg.brandSid);
      if (!r.ok) await this.fail(w, "brand", r);
      else {
        reg.brandStatus = r.status;
        reg.brandFailureReason = r.failureReason || undefined;
        if (r.status === "FAILED" || r.status === "SUSPENDED") {
          if (r.failureReason) {
            w.reg.errors.push({ step: "brand", message: r.failureReason });
          }
          for (const e of r.errors) w.reg.errors.push({ step: "brand", ...e });
        }
      }
    }
    if (reg.campaignSid && reg.serviceSid) {
      const r = await this.trusthub.getCampaign(
        auth,
        reg.serviceSid,
        reg.campaignSid,
      );
      if (!r.ok) await this.fail(w, "campaign", r);
      else {
        reg.campaignStatus = r.status;
        this.noteErrors(w, "campaign", r.status, r.errors);
      }
    }
  }

  // ── steps' plumbing ────────────────────────────────────────────────────────

  /** the platform's ISV primary profile: config, else looked up with the MAIN account (once per registration:
   *  the assignment is recorded, so a resumed walk never asks again). null: none is ISV-type; undefined: the
   *  lookup itself failed (recorded). */
  private async primary(w: Walk): Promise<string | null | undefined> {
    const cfg = this.cfgSource.get();
    if (cfg.a2pPrimaryProfileSid) return cfg.a2pPrimaryProfileSid;
    const main: TwilioAuth = {
      accountSid: cfg.accountSid,
      authToken: cfg.authToken,
    };
    const list = await this.trusthub.listApprovedProfiles(main);
    if (!list.ok) {
      await this.fail(w, "primary", list);
      return undefined;
    }
    for (const bu of list.sids) {
      const a = await this.trusthub.listAssignments(
        main,
        "CustomerProfiles",
        bu,
      );
      if (!a.ok) {
        await this.fail(w, "primary", a);
        return undefined;
      }
      for (const it of a.objectSids.filter((s) => s.startsWith("IT"))) {
        const eu = await this.trusthub.getEndUser(main, it);
        if (!eu.ok) {
          await this.fail(w, "primary", eu);
          return undefined;
        }
        if (
          eu.type === BUSINESS_INFO &&
          eu.attributes.business_identity === ISV_IDENTITY
        ) {
          return bu;
        }
      }
    }
    return null;
  }

  private async assigned(
    w: Walk,
    kind: BundleKind,
    bundle: string,
    object: string,
    step: A2pStep,
  ): Promise<boolean> {
    const key = `${bundle}:${object}`;
    if (w.reg.assigned.includes(key)) return true;
    const r = await this.trusthub.assign(w.auth, kind, bundle, object);
    if (!r.ok) {
      await this.fail(w, step, r);
      return false;
    }
    w.reg.assigned = [...w.reg.assigned, key];
    await this.save(w);
    return true;
  }

  private async evaluated(
    w: Walk,
    kind: BundleKind,
    bundle: string,
    policy: string,
    step: A2pStep,
  ): Promise<boolean> {
    const r = await this.trusthub.evaluate(w.auth, kind, bundle, policy);
    if (!r.ok) {
      await this.fail(w, step, r);
      return false;
    }
    if (r.status === "compliant") return true;
    const errs = evaluationErrors(step, r.results);
    w.reg.errors.push(
      ...(errs.length ? errs : [{
        step,
        message: `Twilio's check came back ${r.status || "noncompliant"}`,
      }]),
    );
    await this.save(w);
    return false;
  }

  /** a refusal is recorded (and saved) on the registration; the walk stops there */
  private async fail(w: Walk, step: A2pStep, f: Failure): Promise<void> {
    w.reg.errors.push({
      step,
      message: f.reason,
      ...(f.code !== undefined ? { code: f.code } : {}),
    });
    await this.save(w);
  }

  private noteErrors(
    w: Walk,
    step: A2pStep,
    status: string,
    errors: { message: string; code?: number }[],
  ): void {
    if (status === "FAILED" || status === "EXPIRED") {
      for (const e of errors) w.reg.errors.push({ step, ...e });
    }
  }

  private async updateEndUsers(w: Walk): Promise<boolean> {
    const { reg, auth } = w;
    const updates: [string | undefined, Record<string, string>, A2pStep][] = [
      [reg.businessEndUserSid, businessAttributes(reg.form), "profile"],
      [reg.repEndUserSid, representativeAttributes(reg.form), "profile"],
      [
        reg.trustProductSubmitted ? undefined : reg.messagingEndUserSid,
        messagingProfileAttributes(reg.form),
        "trust_product",
      ],
    ];
    for (const [sid, attributes, step] of updates) {
      if (!sid) continue;
      const r = await this.trusthub.updateEndUser(auth, sid, attributes);
      if (!r.ok) {
        await this.fail(w, step, r);
        return false;
      }
    }
    return true;
  }

  /** in place: the walk holds `w.reg` by reference */
  private async save(w: Walk): Promise<void> {
    w.reg.state = reduceA2pState(w.reg);
    w.reg.updatedAt = new Date().toISOString();
    await this.store.save(w.reg);
  }

  private async finish(w: Walk): Promise<A2pRegistration> {
    await this.save(w);
    return w.reg;
  }

  private async lineFor(
    userId: string,
  ): Promise<{ line: Line; auth: TwilioAuth }> {
    if (ownsEnvLine(userId, this.cfgSource.get())) {
      throw new A2pHouseLineError();
    }
    const line = await this.lines.findActiveByUser(userId);
    if (!line) throw new NoLineError();
    const { authToken } = await this.lines.open(line);
    return { line, auth: { accountSid: line.subaccountSid, authToken } };
  }
}

export type { A2pError };
