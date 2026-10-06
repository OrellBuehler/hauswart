import { compile } from "@inlang/paraglide-js";
import { paraglideOptions } from "../paraglide.config.ts";

await compile({
  ...paraglideOptions,
  strategy: [...paraglideOptions.strategy],
});

// The inlang SDK keeps a timer alive for ~30s after compiling; exit explicitly.
process.exit(0);
