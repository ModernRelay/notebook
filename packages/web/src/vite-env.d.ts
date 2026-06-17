/// <reference types="vite/client" />

declare module "*.yaml?raw" {
  const content: string;
  export default content;
}

// CSS-only font packages (no bundled type declarations).
declare module "@fontsource-variable/inter";
declare module "@fontsource-variable/geist-mono";
