import ExcelJS from "exceljs";
import type { MatchType, PpcSearchTermRow, PpcStore } from "./types";

export const MOCK_STORES: PpcStore[] = [
  {
    id: "store-bozspacer",
    name: "Bozspacer",
    marketplace: "US",
    targetAcos: 25.0,
    dailyBudget: 450.0,
    status: "ACTIVE",
  },
  {
    id: "store-ncedirect",
    name: "NCE Direct",
    marketplace: "US",
    targetAcos: 30.0,
    dailyBudget: 600.0,
    status: "ACTIVE",
  },
  {
    id: "store-primecraft",
    name: "PrimeCraft Global",
    marketplace: "US",
    targetAcos: 28.0,
    dailyBudget: 350.0,
    status: "ACTIVE",
  },
  {
    id: "store-lumora",
    name: "Lumora Home",
    marketplace: "US",
    targetAcos: 26.0,
    dailyBudget: 400.0,
    status: "ACTIVE",
  },
  {
    id: "store-aerogear",
    name: "AeroGear Pro",
    marketplace: "US",
    targetAcos: 32.0,
    dailyBudget: 500.0,
    status: "ACTIVE",
  },
];

interface RawTermTemplate {
  storeName: string;
  sku: string;
  campaign: string;
  adGroup: string;
  target: string;
  matchType: MatchType;
  query: string;
  impressions: number;
  clicks: number;
  cpc: number;
  orders: number;
  avgOrderValue: number;
  daysAgo: number;
}

const SEED_TEMPLATES: RawTermTemplate[] = [
  // =========================================================================
  // STORE 1: BOZSPACER (Automotive - Spacers, Adapters, Lug Nuts)
  // =========================================================================
  // 1.1 SKU-WHL-SPCR-5X114 (Mustang / Civic / WRX 5x114.3)
  {
    storeName: "Bozspacer",
    sku: "SKU-WHL-SPCR-5X114",
    campaign: "SP_Bozspacer_5x114_Manual_Exact",
    adGroup: "5x114.3 Wheel Spacers",
    target: "wheel spacers 5x114.3",
    matchType: "Exact",
    query: "wheel spacers 5x114.3 20mm",
    impressions: 4800,
    clicks: 168,
    cpc: 0.82,
    orders: 22,
    avgOrderValue: 52.0,
    daysAgo: 1,
  },
  {
    storeName: "Bozspacer",
    sku: "SKU-WHL-SPCR-5X114",
    campaign: "SP_Bozspacer_5x114_Manual_Exact",
    adGroup: "5x114.3 Wheel Spacers",
    target: "5x114.3 wheel spacers 25mm",
    matchType: "Exact",
    query: "5x114.3 wheel spacers 25mm mustang",
    impressions: 3450,
    clicks: 124,
    cpc: 0.78,
    orders: 17,
    avgOrderValue: 54.0,
    daysAgo: 2,
  },
  {
    storeName: "Bozspacer",
    sku: "SKU-WHL-SPCR-5X114",
    campaign: "SP_Bozspacer_5x114_Phrase",
    adGroup: "Hubcentric Spacers",
    target: "hubcentric wheel spacers 5x114.3",
    matchType: "Phrase",
    query: "hubcentric wheel spacers 5x114.3 subaru wrx",
    impressions: 2900,
    clicks: 92,
    cpc: 0.88,
    orders: 11,
    avgOrderValue: 58.0,
    daysAgo: 3,
  },
  {
    storeName: "Bozspacer",
    sku: "SKU-WHL-SPCR-5X114",
    campaign: "SP_Bozspacer_5x114_Phrase",
    adGroup: "Hubcentric Spacers",
    target: "5x114.3 to 5x120 adapter",
    matchType: "Phrase",
    query: "wheel adapters 5x114.3 to 5x120 bmw wheels",
    impressions: 1950,
    clicks: 58,
    cpc: 1.15,
    orders: 4,
    avgOrderValue: 65.0,
    daysAgo: 5,
  },
  {
    storeName: "Bozspacer",
    sku: "SKU-WHL-SPCR-5X114",
    campaign: "SP_Bozspacer_Discovery_Broad",
    adGroup: "Broad Discovery",
    target: "wheel spacers",
    matchType: "Broad",
    query: "cheap universal 4 lug wheel spacers", // Bleeding!
    impressions: 3800,
    clicks: 34,
    cpc: 1.25,
    orders: 0,
    avgOrderValue: 0,
    daysAgo: 2,
  },
  {
    storeName: "Bozspacer",
    sku: "SKU-WHL-SPCR-5X114",
    campaign: "SP_Bozspacer_Discovery_Broad",
    adGroup: "Broad Discovery",
    target: "wheel adapters",
    matchType: "Broad",
    query: "walmart plastic wheel shims 5 lug", // Bleeding!
    impressions: 1600,
    clicks: 19,
    cpc: 1.1,
    orders: 0,
    avgOrderValue: 0,
    daysAgo: 6,
  },
  {
    storeName: "Bozspacer",
    sku: "SKU-WHL-SPCR-5X114",
    campaign: "SP_Bozspacer_Auto_Harvester",
    adGroup: "Auto Close-Match",
    target: "close-match",
    matchType: "Auto",
    query: "20mm hubcentric spacers 5x114.3 67.1", // Golden Harvest candidate
    impressions: 2100,
    clicks: 64,
    cpc: 0.65,
    orders: 9,
    avgOrderValue: 56.0,
    daysAgo: 4,
  },

  // 1.2 SKU-WHL-SPCR-6X139 (Ford F150 / Chevy Silverado / Tacoma)
  {
    storeName: "Bozspacer",
    sku: "SKU-WHL-SPCR-6X139",
    campaign: "SP_Bozspacer_Truck_6Lug_Exact",
    adGroup: "F150 6x135 6x139",
    target: "f150 wheel spacers 1.5 inch",
    matchType: "Exact",
    query: "ford f150 1.5 inch wheel spacers 6x135",
    impressions: 5200,
    clicks: 185,
    cpc: 0.95,
    orders: 24,
    avgOrderValue: 88.0,
    daysAgo: 1,
  },
  {
    storeName: "Bozspacer",
    sku: "SKU-WHL-SPCR-6X139",
    campaign: "SP_Bozspacer_Truck_6Lug_Exact",
    adGroup: "F150 6x135 6x139",
    target: "chevy silverado 1500 2 inch wheel spacers",
    matchType: "Exact",
    query: "chevy silverado 1500 2 inch wheel spacers 6x139.7",
    impressions: 4100,
    clicks: 142,
    cpc: 1.02,
    orders: 19,
    avgOrderValue: 92.0,
    daysAgo: 3,
  },
  {
    storeName: "Bozspacer",
    sku: "SKU-WHL-SPCR-6X139",
    campaign: "SP_Bozspacer_Truck_6Lug_Phrase",
    adGroup: "Toyota Tacoma Spacers",
    target: "tacoma wheel spacers 6 lug",
    matchType: "Phrase",
    query: "toyota tacoma 4runner wheel spacers 1.25 inch",
    impressions: 3300,
    clicks: 98,
    cpc: 0.9,
    orders: 12,
    avgOrderValue: 85.0,
    daysAgo: 4,
  },
  {
    storeName: "Bozspacer",
    sku: "SKU-WHL-SPCR-6X139",
    campaign: "SP_Bozspacer_Truck_Auto",
    adGroup: "Auto Substitutes",
    target: "substitutes",
    matchType: "Auto",
    query: "b081w4dr6g", // Competitor ASIN target
    impressions: 2800,
    clicks: 76,
    cpc: 0.85,
    orders: 7,
    avgOrderValue: 89.0,
    daysAgo: 7,
  },
  {
    storeName: "Bozspacer",
    sku: "SKU-WHL-SPCR-6X139",
    campaign: "SP_Bozspacer_Truck_Broad",
    adGroup: "Broad Bleed",
    target: "truck leveling lift kit",
    matchType: "Broad",
    query: "ford f250 super duty 6 inch suspension lift kit", // Bleeding!
    impressions: 2400,
    clicks: 27,
    cpc: 1.45,
    orders: 0,
    avgOrderValue: 0,
    daysAgo: 8,
  },

  // 1.3 SKU-LUG-NUTS-M14 (Steel Spline Lug Nuts)
  {
    storeName: "Bozspacer",
    sku: "SKU-LUG-NUTS-M14",
    campaign: "SP_Bozspacer_LugNuts_Exact",
    adGroup: "M14x1.5 Black Lug Nuts",
    target: "black lug nuts m14x1.5",
    matchType: "Exact",
    query: "black spline lug nuts m14x1.5 set of 24",
    impressions: 3900,
    clicks: 130,
    cpc: 0.55,
    orders: 26,
    avgOrderValue: 34.0,
    daysAgo: 2,
  },
  {
    storeName: "Bozspacer",
    sku: "SKU-LUG-NUTS-M14",
    campaign: "SP_Bozspacer_LugNuts_Phrase",
    adGroup: "Truck Lug Nuts",
    target: "14x1.5 spike lug nuts",
    matchType: "Phrase",
    query: "silverado spike lug nuts 14x1.5 black chrome",
    impressions: 2200,
    clicks: 65,
    cpc: 0.65,
    orders: 4,
    avgOrderValue: 38.0,
    daysAgo: 5,
  },
  {
    storeName: "Bozspacer",
    sku: "SKU-LUG-NUTS-M14",
    campaign: "SP_Bozspacer_LugNuts_Auto",
    adGroup: "Auto Complements",
    target: "complements",
    matchType: "Auto",
    query: "gorilla wheel locks key replacement m14", // Bleeding!
    impressions: 1750,
    clicks: 21,
    cpc: 0.72,
    orders: 0,
    avgOrderValue: 0,
    daysAgo: 10,
  },

  // =========================================================================
  // STORE 2: NCE DIRECT (POD Drinkware, Mugs, Tumblers, Ornaments)
  // =========================================================================
  // 2.1 SKU-COFFEE-MUG-11OZ (Retirement / Coworker Coffee Mug)
  {
    storeName: "NCE Direct",
    sku: "SKU-COFFEE-MUG-11OZ",
    campaign: "SP_NCE_RetirementMug_Exact",
    adGroup: "Retirement Gifts Mug",
    target: "retirement gifts for women 2026",
    matchType: "Exact",
    query: "retirement gifts for women 2026 funny coffee mug",
    impressions: 6200,
    clicks: 210,
    cpc: 0.68,
    orders: 35,
    avgOrderValue: 18.99,
    daysAgo: 1,
  },
  {
    storeName: "NCE Direct",
    sku: "SKU-COFFEE-MUG-11OZ",
    campaign: "SP_NCE_RetirementMug_Exact",
    adGroup: "Coworker Goodbye Mug",
    target: "coworker leaving gift coffee mug",
    matchType: "Exact",
    query: "coworker leaving gifts funny mug goodbye friend",
    impressions: 4400,
    clicks: 148,
    cpc: 0.62,
    orders: 24,
    avgOrderValue: 19.5,
    daysAgo: 2,
  },
  {
    storeName: "NCE Direct",
    sku: "SKU-COFFEE-MUG-11OZ",
    campaign: "SP_NCE_RetirementMug_Phrase",
    adGroup: "Funny Retirement",
    target: "funny retirement coffee mug",
    matchType: "Phrase",
    query: "a truly great coworker is hard to find coffee mug",
    impressions: 3800,
    clicks: 112,
    cpc: 0.7,
    orders: 15,
    avgOrderValue: 18.99,
    daysAgo: 4,
  },
  {
    storeName: "NCE Direct",
    sku: "SKU-COFFEE-MUG-11OZ",
    campaign: "SP_NCE_RetirementMug_Broad",
    adGroup: "Broad Retirement",
    target: "retirement party ideas",
    matchType: "Broad",
    query: "retirement party decorations balloons banner yard sign", // Bleeding!
    impressions: 4200,
    clicks: 38,
    cpc: 0.85,
    orders: 0,
    avgOrderValue: 0,
    daysAgo: 3,
  },
  {
    storeName: "NCE Direct",
    sku: "SKU-COFFEE-MUG-11OZ",
    campaign: "SP_NCE_RetirementMug_Auto",
    adGroup: "Auto Close",
    target: "close-match",
    matchType: "Auto",
    query: "nurse retirement mug goodbye tension hello pension", // Golden Harvest
    impressions: 2600,
    clicks: 82,
    cpc: 0.58,
    orders: 14,
    avgOrderValue: 18.99,
    daysAgo: 5,
  },

  // 2.2 SKU-TUMBLER-20OZ-SKINNY (20oz Skinny Tumbler)
  {
    storeName: "NCE Direct",
    sku: "SKU-TUMBLER-20OZ-SKINNY",
    campaign: "SP_NCE_SkinnyTumbler_Exact",
    adGroup: "Skinny Tumbler Stainless",
    target: "20 oz skinny tumbler with straw",
    matchType: "Exact",
    query: "20 oz skinny tumbler with lid and straw stainless steel",
    impressions: 7400,
    clicks: 265,
    cpc: 0.75,
    orders: 42,
    avgOrderValue: 24.99,
    daysAgo: 1,
  },
  {
    storeName: "NCE Direct",
    sku: "SKU-TUMBLER-20OZ-SKINNY",
    campaign: "SP_NCE_SkinnyTumbler_Phrase",
    adGroup: "Sublimation Blanks",
    target: "skinny tumbler sublimation blanks",
    matchType: "Phrase",
    query: "white straight skinny tumbler 20oz sublimation bulk 4 pack",
    impressions: 5100,
    clicks: 175,
    cpc: 0.82,
    orders: 22,
    avgOrderValue: 36.0,
    daysAgo: 3,
  },
  {
    storeName: "NCE Direct",
    sku: "SKU-TUMBLER-20OZ-SKINNY",
    campaign: "SP_NCE_SkinnyTumbler_Broad",
    adGroup: "Broad Tumbler",
    target: "insulated water bottle",
    matchType: "Broad",
    query: "stanley 40 oz tumbler quench rose quartz replica", // High ACOS / mismatch
    impressions: 6100,
    clicks: 88,
    cpc: 1.05,
    orders: 2,
    avgOrderValue: 24.99,
    daysAgo: 6,
  },
  {
    storeName: "NCE Direct",
    sku: "SKU-TUMBLER-20OZ-SKINNY",
    campaign: "SP_NCE_SkinnyTumbler_Auto",
    adGroup: "Auto Substitutes",
    target: "substitutes",
    matchType: "Auto",
    query: "b09xyz1234", // Competitor ASIN
    impressions: 3400,
    clicks: 94,
    cpc: 0.72,
    orders: 11,
    avgOrderValue: 26.5,
    daysAgo: 8,
  },

  // 2.3 SKU-ORNAMENT-DOG-ACRYLIC (Personalized Dog Christmas Ornament)
  {
    storeName: "NCE Direct",
    sku: "SKU-ORNAMENT-DOG-ACRYLIC",
    campaign: "SP_NCE_DogOrnament_Exact",
    adGroup: "Dog Memorial Ornament",
    target: "dog christmas ornament personalized",
    matchType: "Exact",
    query: "custom personalized dog christmas ornament with picture photo",
    impressions: 4900,
    clicks: 180,
    cpc: 0.52,
    orders: 31,
    avgOrderValue: 16.99,
    daysAgo: 2,
  },
  {
    storeName: "NCE Direct",
    sku: "SKU-ORNAMENT-DOG-ACRYLIC",
    campaign: "SP_NCE_DogOrnament_Phrase",
    adGroup: "Breed Ornaments",
    target: "golden retriever christmas ornament",
    matchType: "Phrase",
    query: "acrylic flat golden retriever puppy angel christmas ornament",
    impressions: 3100,
    clicks: 105,
    cpc: 0.48,
    orders: 18,
    avgOrderValue: 16.99,
    daysAgo: 4,
  },
  {
    storeName: "NCE Direct",
    sku: "SKU-ORNAMENT-DOG-ACRYLIC",
    campaign: "SP_NCE_DogOrnament_Broad",
    adGroup: "Broad Tree Decor",
    target: "christmas tree decorations",
    matchType: "Broad",
    query: "7ft pre lit artificial christmas tree clear lights", // Bleeding!
    impressions: 3200,
    clicks: 29,
    cpc: 0.95,
    orders: 0,
    avgOrderValue: 0,
    daysAgo: 5,
  },

  // =========================================================================
  // STORE 3: PRIMECRAFT GLOBAL (Leather Goods, Office, Stationery)
  // =========================================================================
  // 3.1 SKU-JOURNAL-LEATHER-VINTAGE (Vintage Leather Journal)
  {
    storeName: "PrimeCraft Global",
    sku: "SKU-JOURNAL-LEATHER-VINTAGE",
    campaign: "SP_PrimeCraft_Journal_Exact",
    adGroup: "Leather Journal Men Women",
    target: "leather journal for men",
    matchType: "Exact",
    query: "vintage leather journal for men writing antique deckle edge",
    impressions: 4200,
    clicks: 140,
    cpc: 0.72,
    orders: 21,
    avgOrderValue: 28.5,
    daysAgo: 1,
  },
  {
    storeName: "PrimeCraft Global",
    sku: "SKU-JOURNAL-LEATHER-VINTAGE",
    campaign: "SP_PrimeCraft_Journal_Phrase",
    adGroup: "Refillable Travel Notebook",
    target: "refillable travel notebook leather",
    matchType: "Phrase",
    query: "handmade rustic leather travel journal refillable diary",
    impressions: 2800,
    clicks: 86,
    cpc: 0.78,
    orders: 11,
    avgOrderValue: 32.0,
    daysAgo: 3,
  },
  {
    storeName: "PrimeCraft Global",
    sku: "SKU-JOURNAL-LEATHER-VINTAGE",
    campaign: "SP_PrimeCraft_Journal_Auto",
    adGroup: "Auto Close",
    target: "close-match",
    matchType: "Auto",
    query: "grimoire spell book blank leather journal shadow", // Golden Harvest
    impressions: 2200,
    clicks: 74,
    cpc: 0.62,
    orders: 12,
    avgOrderValue: 29.99,
    daysAgo: 5,
  },
  {
    storeName: "PrimeCraft Global",
    sku: "SKU-JOURNAL-LEATHER-VINTAGE",
    campaign: "SP_PrimeCraft_Journal_Broad",
    adGroup: "Broad Books",
    target: "fiction books best sellers",
    matchType: "Broad",
    query: "fourth wing hardcover book rebecca yarros", // Bleeding!
    impressions: 2900,
    clicks: 25,
    cpc: 0.98,
    orders: 0,
    avgOrderValue: 0,
    daysAgo: 9,
  },

  // 3.2 SKU-DESK-PAD-LEATHER-XL (Dual-Sided Desk Pad Mat)
  {
    storeName: "PrimeCraft Global",
    sku: "SKU-DESK-PAD-LEATHER-XL",
    campaign: "SP_PrimeCraft_DeskPad_Exact",
    adGroup: "Leather Desk Mat XL",
    target: "leather desk pad protector",
    matchType: "Exact",
    query: "large dual sided pu leather desk pad 36x17 waterproof",
    impressions: 5600,
    clicks: 192,
    cpc: 0.65,
    orders: 28,
    avgOrderValue: 22.99,
    daysAgo: 2,
  },
  {
    storeName: "PrimeCraft Global",
    sku: "SKU-DESK-PAD-LEATHER-XL",
    campaign: "SP_PrimeCraft_DeskPad_Phrase",
    adGroup: "Desk Blotter Office",
    target: "office desk blotter mat",
    matchType: "Phrase",
    query: "extended gaming mouse pad clean leather desk blotter",
    impressions: 3400,
    clicks: 110,
    cpc: 0.7,
    orders: 14,
    avgOrderValue: 23.5,
    daysAgo: 4,
  },
  {
    storeName: "PrimeCraft Global",
    sku: "SKU-DESK-PAD-LEATHER-XL",
    campaign: "SP_PrimeCraft_DeskPad_Broad",
    adGroup: "Broad Desk",
    target: "standing desk converter",
    matchType: "Broad",
    query: "electric standing desk dual motor motorized frame 60 inch", // Bleeding!
    impressions: 3100,
    clicks: 31,
    cpc: 1.15,
    orders: 0,
    avgOrderValue: 0,
    daysAgo: 7,
  },

  // =========================================================================
  // STORE 4: LUMORA HOME (Aromatherapy, Diffusers, Ambient Lighting)
  // =========================================================================
  // 4.1 SKU-DIFFUSER-STONE-CERAMIC (Ultrasonic Ceramic Diffuser)
  {
    storeName: "Lumora Home",
    sku: "SKU-DIFFUSER-STONE-CERAMIC",
    campaign: "SP_Lumora_Diffuser_Exact",
    adGroup: "Stone Ceramic Diffuser",
    target: "stone essential oil diffuser",
    matchType: "Exact",
    query: "ceramic stone essential oil diffuser matte white ultrasonic",
    impressions: 5100,
    clicks: 178,
    cpc: 0.72,
    orders: 26,
    avgOrderValue: 42.0,
    daysAgo: 1,
  },
  {
    storeName: "Lumora Home",
    sku: "SKU-DIFFUSER-STONE-CERAMIC",
    campaign: "SP_Lumora_Diffuser_Phrase",
    adGroup: "Aromatherapy Mist",
    target: "aromatherapy diffuser quiet",
    matchType: "Phrase",
    query: "quiet bedroom essential oil diffuser auto shut off ambient light",
    impressions: 3600,
    clicks: 118,
    cpc: 0.68,
    orders: 16,
    avgOrderValue: 44.0,
    daysAgo: 3,
  },
  {
    storeName: "Lumora Home",
    sku: "SKU-DIFFUSER-STONE-CERAMIC",
    campaign: "SP_Lumora_Diffuser_Auto",
    adGroup: "Auto Close",
    target: "close-match",
    matchType: "Auto",
    query: "vitruvi stone diffuser alternative affordable", // Golden Harvest
    impressions: 2900,
    clicks: 96,
    cpc: 0.64,
    orders: 15,
    avgOrderValue: 42.5,
    daysAgo: 4,
  },
  {
    storeName: "Lumora Home",
    sku: "SKU-DIFFUSER-STONE-CERAMIC",
    campaign: "SP_Lumora_Diffuser_Broad",
    adGroup: "Broad Humidifier",
    target: "cool mist humidifier",
    matchType: "Broad",
    query: "whole house central furnace humidifier filter replacement", // Bleeding!
    impressions: 2800,
    clicks: 26,
    cpc: 0.92,
    orders: 0,
    avgOrderValue: 0,
    daysAgo: 8,
  },

  // 4.2 SKU-NIGHT-LIGHT-MOON (3D Moon Ambient Lamp)
  {
    storeName: "Lumora Home",
    sku: "SKU-NIGHT-LIGHT-MOON",
    campaign: "SP_Lumora_MoonLamp_Exact",
    adGroup: "Moon Lamp 16 Colors",
    target: "3d moon lamp night light",
    matchType: "Exact",
    query: "3d moon lamp 16 colors touch control rechargeable wooden stand",
    impressions: 4300,
    clicks: 145,
    cpc: 0.58,
    orders: 22,
    avgOrderValue: 25.99,
    daysAgo: 2,
  },
  {
    storeName: "Lumora Home",
    sku: "SKU-NIGHT-LIGHT-MOON",
    campaign: "SP_Lumora_MoonLamp_Phrase",
    adGroup: "Gifts for Teens",
    target: "bedroom gifts for teen girls",
    matchType: "Phrase",
    query: "aesthetic bedroom decor gifts for teen girls galaxy lamp",
    impressions: 3200,
    clicks: 102,
    cpc: 0.62,
    orders: 12,
    avgOrderValue: 26.5,
    daysAgo: 6,
  },

  // =========================================================================
  // STORE 5: AEROGEAR PRO (Outdoor, Motorcycle Accessories, Phone Mounts)
  // =========================================================================
  // 5.1 SKU-BIKE-PHONE-MOUNT-CNC (Motorcycle Aluminum Phone Holder)
  {
    storeName: "AeroGear Pro",
    sku: "SKU-BIKE-PHONE-MOUNT-CNC",
    campaign: "SP_AeroGear_PhoneMount_Exact",
    adGroup: "Motorcycle Handlebar Mount",
    target: "motorcycle phone mount vibration dampener",
    matchType: "Exact",
    query: "motorcycle phone mount with anti vibration dampener aluminum cnc",
    impressions: 6100,
    clicks: 225,
    cpc: 0.88,
    orders: 34,
    avgOrderValue: 39.99,
    daysAgo: 1,
  },
  {
    storeName: "AeroGear Pro",
    sku: "SKU-BIKE-PHONE-MOUNT-CNC",
    campaign: "SP_AeroGear_PhoneMount_Phrase",
    adGroup: "Bicycle Phone Holder",
    target: "bicycle phone holder clamp",
    matchType: "Phrase",
    query: "metal bicycle phone holder mount iphone 15 pro max",
    impressions: 3900,
    clicks: 128,
    cpc: 0.82,
    orders: 17,
    avgOrderValue: 38.5,
    daysAgo: 3,
  },
  {
    storeName: "AeroGear Pro",
    sku: "SKU-BIKE-PHONE-MOUNT-CNC",
    campaign: "SP_AeroGear_PhoneMount_Auto",
    adGroup: "Auto Complements",
    target: "complements",
    matchType: "Auto",
    query: "quad lock motorcycle handlebar mount alternative", // Golden Harvest
    impressions: 3100,
    clicks: 104,
    cpc: 0.78,
    orders: 16,
    avgOrderValue: 39.99,
    daysAgo: 4,
  },
  {
    storeName: "AeroGear Pro",
    sku: "SKU-BIKE-PHONE-MOUNT-CNC",
    campaign: "SP_AeroGear_PhoneMount_Broad",
    adGroup: "Broad Phone Mount",
    target: "car phone holder",
    matchType: "Broad",
    query: "magnetic magsafe car vent mount wireless charger", // High ACOS / mismatch
    impressions: 4600,
    clicks: 72,
    cpc: 1.12,
    orders: 1,
    avgOrderValue: 39.99,
    daysAgo: 7,
  },
  {
    storeName: "AeroGear Pro",
    sku: "SKU-BIKE-PHONE-MOUNT-CNC",
    campaign: "SP_AeroGear_PhoneMount_Broad",
    adGroup: "Broad Phone Mount",
    target: "phone stand desk",
    matchType: "Broad",
    query: "wooden phone dock station for nightstand", // Bleeding!
    impressions: 2500,
    clicks: 28,
    cpc: 0.95,
    orders: 0,
    avgOrderValue: 0,
    daysAgo: 10,
  },
];

/**
 * Sinh bộ dữ liệu PPC giả lập phong phú, đa dạng, dài hạn (150-250+ dòng)
 * Bao phủ đầy đủ các kịch bản:
 * - Golden keywords (ACOS < 20%, CVR > 12%)
 * - Good steady performers (ACOS 20-30%)
 * - High ACOS (ACOS 55-85%, cần hạ bid)
 * - Bleeding spend (Clicks >= 9, Orders == 0, cần phủ định)
 * - Trải dài trong 30 ngày gần nhất
 */
export function generateMockSearchTerms(): PpcSearchTermRow[] {
  const rows: PpcSearchTermRow[] = [];
  const baseDate = new Date();

  // Multiplier profiles across 5 historical dates to create realistic longitudinal trend
  const dateOffsets = [0, 2, 5, 8, 14, 21, 28];

  dateOffsets.forEach((daysOffset, dateIndex) => {
    const reportDate = new Date(baseDate.getTime() - daysOffset * 86400 * 1000)
      .toISOString()
      .split("T")[0];

    // Day variance factors
    const dayFactor = 1.0 - dateIndex * 0.04 + (Math.sin(dateIndex * 1.5) * 0.12);

    SEED_TEMPLATES.forEach((tpl, tplIdx) => {
      // Small jitter so rows on different dates aren't identical copies
      const jitter = 0.85 + ((tplIdx * 7 + dateIndex * 13) % 31) / 100;
      const impressions = Math.max(120, Math.round(tpl.impressions * dayFactor * jitter));
      const clicks = Math.max(8, Math.round(tpl.clicks * dayFactor * jitter));
      const spend = Math.round(clicks * tpl.cpc * 100) / 100;

      let orders = 0;
      if (tpl.orders > 0) {
        orders = Math.max(1, Math.round(tpl.orders * dayFactor * jitter));
      }

      const units = orders > 0 ? orders + (orders > 10 ? 2 : orders > 5 ? 1 : 0) : 0;
      const sales = orders > 0 ? Math.round(orders * tpl.avgOrderValue * 100) / 100 : 0.0;

      const cpc = clicks > 0 ? Math.round((spend / clicks) * 100) / 100 : 0;
      const ctr = impressions > 0 ? Math.round((clicks / impressions) * 10000) / 10000 : 0;
      const cvr = clicks > 0 ? Math.round((orders / clicks) * 10000) / 10000 : 0;
      const acos = sales > 0 ? Math.round((spend / sales) * 1000) / 10 : orders === 0 ? 999.0 : 0;
      const roas = spend > 0 ? Math.round((sales / spend) * 100) / 100 : 0;

      rows.push({
        storeName: tpl.storeName,
        reportDate,
        portfolioName: tpl.sku,
        campaignName: tpl.campaign,
        adGroupName: tpl.adGroup,
        targetKeyword: tpl.target,
        customerSearchTerm: tpl.query,
        matchType: tpl.matchType,
        impressions,
        clicks,
        spend,
        sales,
        orders,
        units,
        cpc,
        ctr,
        cvr,
        acos,
        roas,
      });
    });
  });

  return rows;
}

/**
 * Tạo file Excel .xlsx giả lập đúng định dạng thật của Amazon Ads
 */
export async function createMockAmazonSearchTermExcel(storeName = "Bozspacer"): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("SP Search Term Report");

  sheet.columns = [
    { header: "Date", key: "date", width: 12 },
    { header: "Portfolio name", key: "portfolio", width: 25 },
    { header: "Campaign Name", key: "campaign", width: 35 },
    { header: "Ad Group Name", key: "adgroup", width: 25 },
    { header: "Targeting", key: "targeting", width: 25 },
    { header: "Match Type", key: "matchType", width: 15 },
    { header: "Customer Search Term", key: "term", width: 35 },
    { header: "Impressions", key: "impressions", width: 15 },
    { header: "Clicks", key: "clicks", width: 12 },
    { header: "Click-Thru Rate (CTR)", key: "ctr", width: 18 },
    { header: "Cost Per Click (CPC)", key: "cpc", width: 18 },
    { header: "Spend", key: "spend", width: 15 },
    { header: "7 Day Total Sales ($)", key: "sales", width: 20 },
    { header: "Total Advertising Cost of Sales (ACOS)", key: "acos", width: 20 },
    { header: "Total Return on Advertising Spend (ROAS)", key: "roas", width: 20 },
    { header: "7 Day Total Orders (#)", key: "orders", width: 18 },
    { header: "7 Day Total Units (#)", key: "units", width: 18 },
  ];

  const terms = generateMockSearchTerms().filter(
    (t) => !storeName || storeName === "ALL" || (t.storeName && t.storeName.toLowerCase() === storeName.toLowerCase())
  );

  for (const t of terms) {
    sheet.addRow({
      date: t.reportDate,
      portfolio: t.portfolioName,
      campaign: t.campaignName,
      adgroup: t.adGroupName,
      targeting: t.targetKeyword,
      matchType: t.matchType,
      term: t.customerSearchTerm,
      impressions: t.impressions,
      clicks: t.clicks,
      ctr: t.ctr,
      cpc: t.cpc,
      spend: t.spend,
      sales: t.sales,
      acos: t.acos / 100,
      roas: t.roas,
      orders: t.orders,
      units: t.units,
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
