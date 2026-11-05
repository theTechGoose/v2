import { assertEquals } from "@std/assert";
import {
  AD_IDS,
  adFromUrl,
  adPhoto,
  DEFAULT_AD,
  otherAds,
  pickAd,
} from "./landing-ads.ts";

/**
 * REQ-147 — the ad the person tapped: `?ad=` names one of the four, cumple when absent or
 * unknown; the hero shows its photo, the outcomes show the other three in the list's order.
 */
Deno.test("REQ-147 pickAd — one of the four ids, cumple when absent, blank or unknown", () => {
  assertEquals(AD_IDS, ["cumple", "domingo", "sabado", "graduacion"]);
  assertEquals(DEFAULT_AD, "cumple");
  for (const id of AD_IDS) assertEquals(pickAd(id), id);
  assertEquals(pickAd(null), "cumple");
  assertEquals(pickAd(undefined), "cumple");
  assertEquals(pickAd(""), "cumple");
  assertEquals(pickAd("navidad"), "cumple");
  assertEquals(pickAd("Domingo"), "domingo", "case does not matter");
  assertEquals(pickAd(" sabado "), "sabado", "spaces do not matter");
});

Deno.test("REQ-147 adFromUrl — reads ?ad= off the page's URL", () => {
  assertEquals(adFromUrl(new URL("http://x/landing3")), "cumple");
  assertEquals(
    adFromUrl(new URL("http://x/landing3?ad=graduacion")),
    "graduacion",
  );
  assertEquals(
    adFromUrl(new URL("http://x/landing5?lang=en&ad=domingo")),
    "domingo",
  );
  assertEquals(adFromUrl(new URL("http://x/landing4?ad=nope")), "cumple");
});

Deno.test("REQ-147 adPhoto — the tracked file under static, one per ad", () => {
  assertEquals(adPhoto("cumple"), "/ad-cumple.jpg");
  assertEquals(adPhoto("domingo"), "/ad-domingo.jpg");
  assertEquals(adPhoto("sabado"), "/ad-sabado.jpg");
  assertEquals(adPhoto("graduacion"), "/ad-graduacion.jpg");
});

Deno.test("REQ-147 otherAds — the other three, in the list's order", () => {
  assertEquals(otherAds("cumple"), ["domingo", "sabado", "graduacion"]);
  assertEquals(otherAds("domingo"), ["cumple", "sabado", "graduacion"]);
  assertEquals(otherAds("sabado"), ["cumple", "domingo", "graduacion"]);
  assertEquals(otherAds("graduacion"), ["cumple", "domingo", "sabado"]);
});
