/**
 * REQ-280 (demo M33) — /dev/money-input: the MoneyInput island alone, so its typing can be driven
 * in a browser without walking the assistant to the price step. A 404 on the real deploy.
 */
import { HttpError } from "fresh";
import { Head } from "fresh/runtime";
import { define } from "../../utils.ts";
import MoneyInputDemo from "../../islands/MoneyInputDemo.tsx";

export default define.page(function MoneyInputDev() {
  if (Deno.env.get("DENO_DEPLOY")) throw new HttpError(404);
  return (
    <>
      <Head>
        <title>MoneyInput — dev</title>
      </Head>
      <main style="max-width:560px;margin:48px auto;padding:0 20px;font-family:system-ui,sans-serif">
        <h1 style="font-size:22px;margin:0 0 20px">MoneyInput</h1>
        <MoneyInputDemo />
      </main>
    </>
  );
});
