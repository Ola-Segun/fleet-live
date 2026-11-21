import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

const nextConfig: NextConfig = {
    devIndicators : false,
};

void initOpenNextCloudflareForDev();

export default nextConfig;
