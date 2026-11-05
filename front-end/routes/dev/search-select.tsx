/**
 * REQ-136 — /dev/search-select: the SearchSelect island over 1,000 generated rows, so it can be
 * seen and driven locally before it is mounted anywhere. A 404 on the real deploy.
 */
import { asset, Head } from "fresh/runtime";
import { HttpError } from "fresh";
import { define } from "../../utils.ts";
import SearchSelectDemo from "../../islands/SearchSelectDemo.tsx";
import { demoRows } from "../../lib/search-select-demo.ts";

export default define.page(function SearchSelectDev() {
  if (Deno.env.get("DENO_DEPLOY")) throw new HttpError(404);
  const options = demoRows();
  return (
    <>
      <Head>
        <title>SearchSelect — dev</title>
        <link
          key="css-dashboard"
          rel="stylesheet"
          href={asset("/dashboard.css")}
        />
        <link
          key="css-search-select"
          rel="stylesheet"
          href={asset("/search-select.css")}
        />
      </Head>
      <main style="max-width:560px;margin:48px auto;padding:0 20px;font-family:system-ui,sans-serif;color:var(--fg,#1a535c)">
        <h1 style="font-size:22px;margin:0 0 4px">SearchSelect</h1>
        <p style="margin:0 0 20px;color:var(--fg-muted,#555)">
          Type to filter {options.length.toLocaleString("en-US")}{" "}
          rows. Arrows move, Enter picks, Escape closes.
        </p>
        <SearchSelectDemo options={options} />
      </main>
    </>
  );
});
