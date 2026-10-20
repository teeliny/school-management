const NOTICE_ID = "unsupported-browser-notice";

// Must stay plain ES5 — it exists precisely for browsers that can't parse
// the app bundle. The bundle is transpiled to ES2020 syntax (see
// next.config.mjs transpilePackages), so a browser that can't compile
// optional chaining / nullish coalescing (e.g. Safari 12 on iOS 12 iPads)
// never hydrates: forms do a native reload and clear, buttons do nothing.
const detectScript = `(function(){try{new Function("var a=null;return a?.b??1")}catch(e){var n=document.getElementById("${NOTICE_ID}");if(n)n.style.display="block"}})();`;

/**
 * Hard-stop counterpart to BrowserSupportBanner: that one needs React to run,
 * so it can never render on a browser too old to hydrate at all. This is
 * server-rendered hidden and revealed by an inline script before any bundle
 * loads. Inline hex styles rather than Tailwind tokens — the token CSS
 * (`rgb(var(--x) / a)`) is itself unparseable on these browsers.
 */
export function UnsupportedBrowserNotice() {
  return (
    <>
      <div
        id={NOTICE_ID}
        role="alert"
        style={{
          display: "none",
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
          zIndex: 100,
          padding: "48px 24px",
          background: "#f5eed4",
          color: "#001B3A",
          textAlign: "center",
          fontFamily: "-apple-system, Helvetica, Arial, sans-serif",
          lineHeight: 1.5,
        }}
      >
        <h1 style={{ fontSize: "20px", fontWeight: 600, margin: "0 0 12px" }}>This device&apos;s browser is too old</h1>
        <p style={{ fontSize: "15px", maxWidth: "420px", margin: "0 auto" }}>
          This portal needs a newer web browser than this device can run. Please sign in from a more
          recent phone, tablet or computer, or update this device&apos;s software if an update is
          available.
        </p>
      </div>
      <script dangerouslySetInnerHTML={{ __html: detectScript }} />
    </>
  );
}
