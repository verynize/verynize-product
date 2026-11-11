// Generated from web/index.html by web-start/build/legacy-web.mjs.
declare module "virtual:verynize/legacy-shell" {
  const shell: {
    title: string;
    assetUrls: Record<string, string>;
    styles: { href?: string; text?: string }[];
    bodyAttributes: Record<string, string>;
    bodyHtml: string;
    scripts: { attrs: Record<string, string>; text?: string }[];
  };
  export default shell;
}

// The renderer UI from source (web/src/web-app.tsx) on the client; an empty module on the server.
declare module "virtual:verynize/legacy-ui" {
  export * from "@/web-app";
}
