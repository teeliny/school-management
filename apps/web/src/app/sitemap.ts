import type { MetadataRoute } from "next";
import { SITE_URL } from "../lib/site-url";

const PUBLIC_ROUTES = ["", "/about", "/academics", "/admissions", "/careers"];

export default function sitemap(): MetadataRoute.Sitemap {
  return PUBLIC_ROUTES.map((route) => ({
    url: `${SITE_URL}${route}`,
    lastModified: new Date(),
  }));
}
