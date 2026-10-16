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
  const stores: Store[] = names.map((name, i) => {
    const date = customDate || dateInZone("Asia/Kolkata", today ? 0 : -1),
      factor = today ? 0.42 : 1,
      spend = Math.round((1800 + i * 291) * factor),
      budget = 3000 + i * 400;
    return {
      id: `demo-${i}`,
      name,
      domain: `example-${i + 1}.myshopify.com`,
      cid: `000000${String(i + 1).padStart(4, "0")}`,
      group: (i % 3) + 1,
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
            targetCpa: i % 3 === 0 ? 220 + i * 5 : null,
            biddingStrategy:
              i % 3 === 0 ? "TARGET_CPA" : "MAXIMIZE_CONVERSIONS",
          },
        ],
        alerts: [],
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
  return stores.map((store, i) => {
    const todayDate = dateInZone("Asia/Kolkata");
    const asOf = new Date().toISOString();
    const hourAt = new Date(Date.now() - 3600000).toISOString();
    const factor = today ? 1 : 0.42;
    const ads = {
      ...store.ads!,
      date: todayDate,
      fetchedAt: asOf,
      spend: Math.round(store.ads!.spend! * factor),
      purchases: Math.round(store.ads!.purchases! * factor),
    };
    const shop = {
      ...store.shop!,
      date: todayDate,
      fetchedAt: asOf,
      orders: Math.round(store.shop!.orders! * factor),
    };
    const yesterdayOrders = Math.max(
      1,
      Math.round(shop.orders * (i % 3 === 0 ? 1.6 : i % 3 === 1 ? 0.6 : 1)),
    );
    const delta = Math.round(shop.orders * 0.25);
    const clockMinute = (at: string) => {
      const [hour, minute] = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Kolkata",
        hourCycle: "h23",
        hour: "2-digit",
        minute: "2-digit",
      })
        .format(new Date(at))
        .split(":")
        .map(Number);
      return hour * 60 + minute;
    };
    store.live = {
      orderHistory: [
        {
          date: todayDate,
          at: hourAt,
          orders: shop.orders - delta,
          minute: clockMinute(hourAt),
        },
        {
          date: todayDate,
          at: asOf,
          orders: shop.orders,
          minute: clockMinute(asOf),
        },
        {
          date: dateInZone("Asia/Kolkata", -1),
          at: new Date(Date.now() - 86400000).toISOString(),
          orders: yesterdayOrders,
          minute: clockMinute(asOf),
        },
      ],
      today: { ads, shop, adsError: null, shopError: null },
      hourAgo: {
        ads: {
          ...ads,
          fetchedAt: hourAt,
          spend: Math.round(ads.spend * 0.75),
          purchases: Math.round(ads.purchases * 0.75),
        },
        shop: { ...shop, fetchedAt: hourAt, orders: shop.orders - delta },
        adsError: null,
        shopError: null,
      },
      orderFlow: {
        state: i % 3 === 0 ? "slower" : i % 3 === 1 ? "ahead" : "on_pace",
        todayOrders: shop.orders,
        yesterdayOrders,
        percent: ((shop.orders - yesterdayOrders) / yesterdayOrders) * 100,
        asOf,
        baselineAt: new Date(Date.now() - 86400000).toISOString(),
        hourlyDelta: delta,
      },
    };
    return store;
  });
}
