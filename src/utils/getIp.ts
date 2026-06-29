import { Request } from "express";

/**
 * Extracts the real IP address from the request, resolving proxies and normalizing localhost.
 */
export const getIpAddress = (req: any): string => {
  let ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress || req.ip || "";
  
  if (Array.isArray(ip)) {
    ip = ip[0];
  }
  
  // Get the first IP if it's a comma-separated list
  ip = ip.split(",")[0].trim();

  // Normalize loopback to IPv4
  if (ip === "::1") {
    return "127.0.0.1";
  }
  
  // Strip IPv4-mapped IPv6 prefix
  if (ip.startsWith("::ffff:")) {
    return ip.replace("::ffff:", "");
  }

  return ip || "Unknown";
};
