import type { Config } from "tailwindcss";
import sharedConfig from "@repo/ui/tailwind.config";

export default {
    ...sharedConfig,
    content: [
        "./pages/**/*.{js,ts,jsx,tsx,mdx}",
        "./components/**/*.{js,ts,jsx,tsx,mdx}",
        "./app/**/*.{js,ts,jsx,tsx,mdx}",
        "../../packages/ui/src/**/*.{js,ts,jsx,tsx,mdx}"
    ],
} satisfies Config;
