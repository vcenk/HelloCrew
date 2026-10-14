export function createWidgetLoaderScript() {
  return `(() => {
  "use strict";
  const script = document.currentScript;
  if (!script) return;
  const installation = script.dataset.installation || "";
  if (!/^[a-z0-9][a-z0-9-]{2,63}$/.test(installation)) {
    console.error("HelloCrew: add a valid data-installation value.");
    return;
  }
  if (document.querySelector('[data-hellocrew-widget="' + installation + '"]')) return;

  const mount = () => {
    const widgetOrigin = new URL(script.src, window.location.href).origin;
    const container = document.createElement("div");
    container.dataset.hellocrewWidget = installation;
    container.setAttribute("aria-label", "HelloCrew website chat");
    Object.assign(container.style, {
      position: "fixed",
      right: "12px",
      bottom: "12px",
      width: "84px",
      height: "84px",
      zIndex: "2147483000",
      transition: "width 180ms ease, height 180ms ease",
    });

    const frame = document.createElement("iframe");
    frame.src = widgetOrigin + "/widget/" + encodeURIComponent(installation);
    frame.title = "Chat with this business";
    frame.setAttribute("sandbox", "allow-forms allow-same-origin allow-scripts");
    frame.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
    Object.assign(frame.style, {
      width: "100%",
      height: "100%",
      border: "0",
      colorScheme: "light",
      background: "transparent",
    });
    container.appendChild(frame);
    document.body.appendChild(container);

    window.addEventListener("message", (event) => {
      if (event.origin !== widgetOrigin || event.source !== frame.contentWindow) return;
      if (!event.data || event.data.source !== "hellocrew-widget") return;
      const open = event.data.type === "resize" && event.data.open === true;
      container.style.width = open ? "min(390px, calc(100vw - 24px))" : "84px";
      container.style.height = open ? "min(650px, calc(100vh - 24px))" : "84px";
    });
  };

  if (document.body) mount();
  else window.addEventListener("DOMContentLoaded", mount, { once: true });
})();`;
}
