import type { Store } from "./types";
import { dateInZone } from "./reporting";
const names = [
  "Oak & Linen",
  "Forma Living",
  "Sunday Ritual",
  "North Supply",
  "Everyday Goods",
  "Mellow Home",
  "Thread Studio",
  "Bare Essentials",
  "Olive & Co.",
  "Luna Objects",
  "The Good Edit",
  "Fieldwork",
  "Kindred Kitchen",
  "Aster Skincare",
  "Terra House",
  "Wildflower",
  "Nook Living",
  "Studio One",
  "Rooted Wellness",
  "Soft Season",
  "Peak Outdoors",
  "Salt & Stone",
  "Daily Carry",
  "Bloom Market",
  "Crafted Goods",
];
export function demoStores(today = false, customDate?: string): Store[] {
  return names.map((name, i) => {
    const date = customDate || dateInZone("Asia/Kolkata", today ? 0 : -1),
      factor = today ? 0.42 : 1,
      spend = Math.round((1800 + i * 291) * factor),
      budget = 3000 + i * 400;
    return {
      id: `demo-${i}`,
      name,
      domain: `example-${i + 1}.myshopify.com`,
      cid: `000000${String(i + 1).padStart(4, "0")}`,
      group: i % 3 + 1,
      managerCid: "",
      shopConnected: true,
      adsError: null,
      shopError: null,
      ads: {
        spend,
        purchases: Math.round((8 + i) * factor),
        costPerPurchase: i % 5 === 0 ? null : 185 + i * 8,
        costNote: "Illustrative Google Ads value. Example data only.",
        currency: "INR",
        timezone: "Asia/Kolkata",
        date,
        fetchedAt: new Date().toISOString(),
        budgets: [
          {
            id: "b1",
            name: "Main daily budget",
            amount: budget,
            shared: i % 4 === 0,
            period: "DAILY",
            campaigns: [
              "Shopping · Main",
              ...(i % 4 === 0 ? ["Search · Brand"] : []),
            ],
          },
        ],
        campaigns: [
          {
            id: "c1",
            name: "Shopping · Main",
            status: "ENABLED",
            spend,
            budgetId: "b1",
          },
        ],
        raw: null,
      },
      shop: {
        sales: Math.round((spend * 2.8 + i * 103) * factor),
        orders: Math.round((12 + i) * factor),
        currency: "INR",
        timezone: "Asia/Kolkata",
        date,
        fetchedAt: new Date().toISOString(),
        raw: null,
      },
    };
  });
}
