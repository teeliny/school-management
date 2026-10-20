/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@school/types", "@tanstack/query-core", "@tanstack/react-query", "recharts", "reselect", "immer", "redux", "react-redux", "@reduxjs/toolkit", "zod"],
};

export default nextConfig;
