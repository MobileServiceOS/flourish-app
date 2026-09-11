// GENERATED FROM THE CLOVER INVENTORY EXPORT — do not hand-edit prices.
// Regenerate with:  npm run menu -- <clover-export.xlsx>
// Descriptions, Popular ids and Seafood Friday day-locks live in the DESC /
// POPULAR_IDS / CATEGORY_DAYS maps in scripts/generate-menu.mjs, so a regen
// keeps them. Edit them there, not here.
// Every id / gid is a live Clover object id, so an order maps 1:1 onto the register.
// Line price = base + selected variant modifier + side upcharges.
// Defaults to the first available option in each group (Clover's own ordering).
// oos:true marks a modifier Clover has mispriced; hidden rather than sold wrong.
// See CLOVER-FIXES.md for the six issues found and what to correct in Clover.
export const MENU = [
  { cat: "Lunch & Dinner", sub: "Plates come with two sides", items: [
    { id: "598S0BJH4J7DE", name: "Crab Legs Platter", emoji: "🦀",
        desc: "Crab legs and shrimp with two sides", base: 50.0, lo: 50.0, hi: 50.0, prepMinutes: 30, search: "crab legs platter", groups: [
        { gid: "YQWN3PKBKV9NG", name: "Side With Meal", kind: "side", mods: [{ n: "White Rice", p: 0.0 }, { n: "Mac And Cheese", p: 0.0 }, { n: "Rice And Peas", p: 0.0 }, { n: "Fried Chicken", p: 6.0 }, { n: "Festival", p: 0.0 }, { n: "Pasta", p: 0.0 }, { n: "Shrimp", p: 5.0 }, { n: "Whiting Fish X1", p: 2.5 }, { n: "Mashed Potatoes", p: 0.0 }, { n: "Waffles", p: 0.0 }, { n: "Seafood Mac", p: 3.5 }, { n: "Candied Yams", p: 0.0 }, { n: "Steam Veg.", p: 0.0 }, { n: "Plaintain", p: 0.0 }] }
      ] },
    { id: "VGZYVZCB2NCRY", name: "Lobster", emoji: "🦞",
        desc: "Whole lobster with two sides", base: 45.0, lo: 45.0, hi: 45.0, prepMinutes: 30, search: "lobster", groups: [
        { gid: "YQWN3PKBKV9NG", name: "Side With Meal", kind: "side", mods: [{ n: "White Rice", p: 0.0 }, { n: "Mac And Cheese", p: 0.0 }, { n: "Rice And Peas", p: 0.0 }, { n: "Fried Chicken", p: 6.0 }, { n: "Festival", p: 0.0 }, { n: "Pasta", p: 0.0 }, { n: "Shrimp", p: 5.0 }, { n: "Whiting Fish X1", p: 2.5 }, { n: "Mashed Potatoes", p: 0.0 }, { n: "Waffles", p: 0.0 }, { n: "Seafood Mac", p: 3.5 }, { n: "Candied Yams", p: 0.0 }, { n: "Steam Veg.", p: 0.0 }, { n: "Plaintain", p: 0.0 }] }
      ] },
    { id: "7916EWVQFPGH8", name: "Lamb", emoji: "🥩",
        desc: "Slow-braised lamb with two sides", base: 30.0, lo: 30.0, hi: 30.0, prepMinutes: 30, search: "lamb", groups: [
        { gid: "YQWN3PKBKV9NG", name: "Side With Meal", kind: "side", mods: [{ n: "White Rice", p: 0.0 }, { n: "Mac And Cheese", p: 0.0 }, { n: "Rice And Peas", p: 0.0 }, { n: "Fried Chicken", p: 6.0 }, { n: "Festival", p: 0.0 }, { n: "Pasta", p: 0.0 }, { n: "Shrimp", p: 5.0 }, { n: "Whiting Fish X1", p: 2.5 }, { n: "Mashed Potatoes", p: 0.0 }, { n: "Waffles", p: 0.0 }, { n: "Seafood Mac", p: 3.5 }, { n: "Candied Yams", p: 0.0 }, { n: "Steam Veg.", p: 0.0 }, { n: "Plaintain", p: 0.0 }] }
      ] },
    { id: "VQZ0T4XK707EC", name: "Snapper Fish", emoji: "🐠",
        desc: "Brown stew, escovitch, or steamed", base: 0.0, lo: 30.0, hi: 30.0, prepMinutes: 30, search: "snapper fish brown stew escovitch steam", groups: [
        { gid: "YQWN3PKBKV9NG", name: "Side With Meal", kind: "side", mods: [{ n: "White Rice", p: 0.0 }, { n: "Mac And Cheese", p: 0.0 }, { n: "Rice And Peas", p: 0.0 }, { n: "Fried Chicken", p: 6.0 }, { n: "Festival", p: 0.0 }, { n: "Pasta", p: 0.0 }, { n: "Shrimp", p: 5.0 }, { n: "Whiting Fish X1", p: 2.5 }, { n: "Mashed Potatoes", p: 0.0 }, { n: "Waffles", p: 0.0 }, { n: "Seafood Mac", p: 3.5 }, { n: "Candied Yams", p: 0.0 }, { n: "Steam Veg.", p: 0.0 }, { n: "Plaintain", p: 0.0 }] },
        { gid: "AJY3FTT4BRPHP", name: "Fish", kind: "variant", mods: [{ n: "Brown Stew Fish", p: 30.0 }, { n: "Escovitch", p: 30.0 }, { n: "Steam Fish", p: 30.0 }, { n: "Whiting Fish", p: 14.0, oos: true }, { n: "Snapper Fish (Add On. No Sides)", p: 20.0, oos: true }] }
      ] },
    { id: "ZTAQ37M4E9S4C", name: "Stew Peas", emoji: "🫘",
        desc: "Red peas simmered in coconut milk", base: 0.0, lo: 15.0, hi: 18.0, prepMinutes: 15, search: "stew peas medium large", groups: [
        { gid: "KR1HHY64E4QPJ", name: "Stew Peas", kind: "variant", mods: [{ n: "Medium", p: 15.0 }, { n: "Large", p: 18.0 }, { n: "Seafood", p: 30.0, oos: true }] },
        { gid: "YQWN3PKBKV9NG", name: "Side With Meal", kind: "side", mods: [{ n: "White Rice", p: 0.0 }, { n: "Mac And Cheese", p: 0.0 }, { n: "Rice And Peas", p: 0.0 }, { n: "Fried Chicken", p: 6.0 }, { n: "Festival", p: 0.0 }, { n: "Pasta", p: 0.0 }, { n: "Shrimp", p: 5.0 }, { n: "Whiting Fish X1", p: 2.5 }, { n: "Mashed Potatoes", p: 0.0 }, { n: "Waffles", p: 0.0 }, { n: "Seafood Mac", p: 3.5 }, { n: "Candied Yams", p: 0.0 }, { n: "Steam Veg.", p: 0.0 }, { n: "Plaintain", p: 0.0 }] }
      ] },
    { id: "32VDQ4G5J131P", name: "Seafood Stew Peas", emoji: "🫘",
        desc: "Stew peas loaded with seafood. One size, large.", days: [5, 6], base: 30.0, lo: 30.0, hi: 30.0, prepMinutes: 30, search: "seafood stew peas", groups: [
      ] },
    { id: "60KCQ1V22Q98M", name: "Oxtail", emoji: "🍖",
        desc: "Slow-cooked, fall-off-the-bone tender", base: 0.0, lo: 20.0, hi: 25.0, prepMinutes: 15, search: "oxtail medium large", groups: [
        { gid: "45KGD3ZDMT2ZY", name: "Oxtail Size", kind: "variant", mods: [{ n: "Medium", p: 20.0 }, { n: "Large", p: 25.0 }] },
        { gid: "YQWN3PKBKV9NG", name: "Side With Meal", kind: "side", mods: [{ n: "White Rice", p: 0.0 }, { n: "Mac And Cheese", p: 0.0 }, { n: "Rice And Peas", p: 0.0 }, { n: "Fried Chicken", p: 6.0 }, { n: "Festival", p: 0.0 }, { n: "Pasta", p: 0.0 }, { n: "Shrimp", p: 5.0 }, { n: "Whiting Fish X1", p: 2.5 }, { n: "Mashed Potatoes", p: 0.0 }, { n: "Waffles", p: 0.0 }, { n: "Seafood Mac", p: 3.5 }, { n: "Candied Yams", p: 0.0 }, { n: "Steam Veg.", p: 0.0 }, { n: "Plaintain", p: 0.0 }] }
      ] },
    { id: "JAD3BJK9BSTW8", name: "Pasta", emoji: "🍝",
        desc: "Plain, chicken, shrimp, steak, or oxtail", base: 0.0, lo: 15.0, hi: 25.0, prepMinutes: 15, search: "pasta plain chicken shrimp garlic penne alla vodka steak oxtail", groups: [
        { gid: "D0F1SFXHWSQWT", name: "Pasta", kind: "variant", mods: [{ n: "Plain Pasta", p: 15.0 }, { n: "Chicken", p: 18.0 }, { n: "Shrimp", p: 20.0 }, { n: "Garlic", p: 15.0 }, { n: "Penne Alla Vodka", p: 18 }, { n: "Steak", p: 25.0 }, { n: "Oxtail", p: 24 }] }
      ] },
    { id: "H9520PFNBT2NY", name: "Salmon", emoji: "🐟",
        desc: "Honey garlic, jerk, sweet chili, grilled, or steamed", base: 0.0, lo: 22.0, hi: 22.0, prepMinutes: 30, search: "salmon sweet chili grilled honey garlic", groups: [
        { gid: "ZR29AF0E4JPXA", name: "Salmon", kind: "variant", mods: [{ n: "Sweet Chili", p: 22.0 }, { n: "Grilled", p: 22.0 }, { n: "Steamed", p: 22.0, oos: true }, { n: "Honey Garlic", p: 22.0 }, { n: "Jerk", p: 22.0, oos: true }] },
        { gid: "YQWN3PKBKV9NG", name: "Side With Meal", kind: "side", mods: [{ n: "White Rice", p: 0.0 }, { n: "Mac And Cheese", p: 0.0 }, { n: "Rice And Peas", p: 0.0 }, { n: "Fried Chicken", p: 6.0 }, { n: "Festival", p: 0.0 }, { n: "Pasta", p: 0.0 }, { n: "Shrimp", p: 5.0 }, { n: "Whiting Fish X1", p: 2.5 }, { n: "Mashed Potatoes", p: 0.0 }, { n: "Waffles", p: 0.0 }, { n: "Seafood Mac", p: 3.5 }, { n: "Candied Yams", p: 0.0 }, { n: "Steam Veg.", p: 0.0 }, { n: "Plaintain", p: 0.0 }] }
      ] },
    { id: "AYBW9QMTC6154", name: "Ackee & Shrimp", emoji: "🍤",
        desc: "Ackee and shrimp with two sides", base: 20.0, lo: 20.0, hi: 20.0, prepMinutes: 30, search: "ackee shrimp", groups: [
        { gid: "YQWN3PKBKV9NG", name: "Side With Meal", kind: "side", mods: [{ n: "White Rice", p: 0.0 }, { n: "Mac And Cheese", p: 0.0 }, { n: "Rice And Peas", p: 0.0 }, { n: "Fried Chicken", p: 6.0 }, { n: "Festival", p: 0.0 }, { n: "Pasta", p: 0.0 }, { n: "Shrimp", p: 5.0 }, { n: "Whiting Fish X1", p: 2.5 }, { n: "Mashed Potatoes", p: 0.0 }, { n: "Waffles", p: 0.0 }, { n: "Seafood Mac", p: 3.5 }, { n: "Candied Yams", p: 0.0 }, { n: "Steam Veg.", p: 0.0 }, { n: "Plaintain", p: 0.0 }] }
      ] },
    { id: "VHHCS7EDV70HC", name: "Shrimp", emoji: "🍤",
        desc: "Sweet chili, garlic, curried, pepper, grilled, or fried", base: 0.0, lo: 20.0, hi: 20.0, prepMinutes: 30, search: "shrimp garlic curried pepper sweet chili grilled fried", groups: [
        { gid: "YQWN3PKBKV9NG", name: "Side With Meal", kind: "side", mods: [{ n: "White Rice", p: 0.0 }, { n: "Mac And Cheese", p: 0.0 }, { n: "Rice And Peas", p: 0.0 }, { n: "Fried Chicken", p: 6.0 }, { n: "Festival", p: 0.0 }, { n: "Pasta", p: 0.0 }, { n: "Shrimp", p: 5.0 }, { n: "Whiting Fish X1", p: 2.5 }, { n: "Mashed Potatoes", p: 0.0 }, { n: "Waffles", p: 0.0 }, { n: "Seafood Mac", p: 3.5 }, { n: "Candied Yams", p: 0.0 }, { n: "Steam Veg.", p: 0.0 }, { n: "Plaintain", p: 0.0 }] },
        { gid: "4BY3GKC2SVJ90", name: "Shrimp", kind: "variant", mods: [{ n: "Garlic", p: 20.0 }, { n: "Curried", p: 20.0 }, { n: "Pepper", p: 20.0 }, { n: "Sweet Chili", p: 20.0 }, { n: "Grilled", p: 20.0 }, { n: "Fried", p: 20.0 }] }
      ] },
    { id: "8FW3GVMJKCGZG", name: "Pork", emoji: "🥓",
        desc: "Stew or jerk, medium or large", base: 0.0, lo: 20.0, hi: 25.0, prepMinutes: 15, search: "pork medium stew large jerk", groups: [
        { gid: "YQWN3PKBKV9NG", name: "Side With Meal", kind: "side", mods: [{ n: "White Rice", p: 0.0 }, { n: "Mac And Cheese", p: 0.0 }, { n: "Rice And Peas", p: 0.0 }, { n: "Fried Chicken", p: 6.0 }, { n: "Festival", p: 0.0 }, { n: "Pasta", p: 0.0 }, { n: "Shrimp", p: 5.0 }, { n: "Whiting Fish X1", p: 2.5 }, { n: "Mashed Potatoes", p: 0.0 }, { n: "Waffles", p: 0.0 }, { n: "Seafood Mac", p: 3.5 }, { n: "Candied Yams", p: 0.0 }, { n: "Steam Veg.", p: 0.0 }, { n: "Plaintain", p: 0.0 }] },
        { gid: "907Z8BF726CQ4", name: "Pork", kind: "variant", mods: [{ n: "Medium Stew", p: 20 }, { n: "Large Stew", p: 25 }, { n: "Medium Jerk", p: 20 }, { n: "Large Jerk", p: 25 }] }
      ] },
    { id: "PSGB77QNZR2WM", name: "Blue Crab", emoji: "🦀",
        desc: "Blue crab with two sides", base: 20.0, lo: 20.0, hi: 20.0, prepMinutes: 30, search: "blue crab", groups: [
        { gid: "YQWN3PKBKV9NG", name: "Side With Meal", kind: "side", mods: [{ n: "White Rice", p: 0.0 }, { n: "Mac And Cheese", p: 0.0 }, { n: "Rice And Peas", p: 0.0 }, { n: "Fried Chicken", p: 6.0 }, { n: "Festival", p: 0.0 }, { n: "Pasta", p: 0.0 }, { n: "Shrimp", p: 5.0 }, { n: "Whiting Fish X1", p: 2.5 }, { n: "Mashed Potatoes", p: 0.0 }, { n: "Waffles", p: 0.0 }, { n: "Seafood Mac", p: 3.5 }, { n: "Candied Yams", p: 0.0 }, { n: "Steam Veg.", p: 0.0 }, { n: "Plaintain", p: 0.0 }] }
      ] },
    { id: "QB9EKT4QGVWDA", name: "Shrimp & Waffles", emoji: "🧇",
        desc: "Shrimp over waffles, six flavors to pick from", base: 20.0, lo: 20.0, hi: 20.0, prepMinutes: 30, search: "shrimp waffles red velvet strawberry easter bun cinnamin buttermilk coconut toto", groups: [
        { gid: "YQWN3PKBKV9NG", name: "Side With Meal", kind: "side", mods: [{ n: "White Rice", p: 0.0 }, { n: "Mac And Cheese", p: 0.0 }, { n: "Rice And Peas", p: 0.0 }, { n: "Fried Chicken", p: 6.0 }, { n: "Festival", p: 0.0 }, { n: "Pasta", p: 0.0 }, { n: "Shrimp", p: 5.0 }, { n: "Whiting Fish X1", p: 2.5 }, { n: "Mashed Potatoes", p: 0.0 }, { n: "Waffles", p: 0.0 }, { n: "Seafood Mac", p: 3.5 }, { n: "Candied Yams", p: 0.0 }, { n: "Steam Veg.", p: 0.0 }, { n: "Plaintain", p: 0.0 }] },
        { gid: "3VQCJ6J8Q465P", name: "Waffles Flavors", kind: "flavor", mods: [{ n: "Red Velvet", p: 0.0 }, { n: "Strawberry", p: 0.0 }, { n: "Easter Bun", p: 0.0 }, { n: "Cinnamin", p: 0.0 }, { n: "Buttermilk", p: 0.0 }, { n: "Coconut Toto", p: 0.0 }] }
      ] },
    { id: "C2RD25C1VXNN0", name: "Wings", emoji: "🔥",
        desc: "Made to order. Pick your sauce.", base: 0.0, lo: 15.0, hi: 18.0, prepMinutes: 15, search: "wings medium large chili honey bbq garlic mango habanero jerk henny", groups: [
        { gid: "4BWH51GY6DSEY", name: "Wings", kind: "variant", mods: [{ n: "Medium", p: 15.0 }, { n: "Large", p: 18.0 }, { n: "Wings", p: 1.5, oos: true }] },
        { gid: "YQWN3PKBKV9NG", name: "Side With Meal", kind: "side", mods: [{ n: "White Rice", p: 0.0 }, { n: "Mac And Cheese", p: 0.0 }, { n: "Rice And Peas", p: 0.0 }, { n: "Fried Chicken", p: 6.0 }, { n: "Festival", p: 0.0 }, { n: "Pasta", p: 0.0 }, { n: "Shrimp", p: 5.0 }, { n: "Whiting Fish X1", p: 2.5 }, { n: "Mashed Potatoes", p: 0.0 }, { n: "Waffles", p: 0.0 }, { n: "Seafood Mac", p: 3.5 }, { n: "Candied Yams", p: 0.0 }, { n: "Steam Veg.", p: 0.0 }, { n: "Plaintain", p: 0.0 }] },
        { gid: "4MT0W7554719J", name: "Flavors", kind: "flavor", mods: [{ n: "Chili", p: 0.0 }, { n: "Honey Bbq", p: 0.0 }, { n: "Honey Garlic", p: 0.0 }, { n: "Mango Habanero", p: 0.0 }, { n: "Jerk", p: 0.0 }, { n: "Henny", p: 0.0 }] }
      ] },
    { id: "NEAR47KAE44HC", name: "Curried Goat", emoji: "🍛",
        desc: "Tender island-style curry goat", base: 0.0, lo: 15.0, hi: 18.0, prepMinutes: 15, search: "curried goat medium large", groups: [
        { gid: "YQWN3PKBKV9NG", name: "Side With Meal", kind: "side", mods: [{ n: "White Rice", p: 0.0 }, { n: "Mac And Cheese", p: 0.0 }, { n: "Rice And Peas", p: 0.0 }, { n: "Fried Chicken", p: 6.0 }, { n: "Festival", p: 0.0 }, { n: "Pasta", p: 0.0 }, { n: "Shrimp", p: 5.0 }, { n: "Whiting Fish X1", p: 2.5 }, { n: "Mashed Potatoes", p: 0.0 }, { n: "Waffles", p: 0.0 }, { n: "Seafood Mac", p: 3.5 }, { n: "Candied Yams", p: 0.0 }, { n: "Steam Veg.", p: 0.0 }, { n: "Plaintain", p: 0.0 }] },
        { gid: "ZQKXN5HY71ERM", name: "Curried Goat", kind: "variant", mods: [{ n: "Medium", p: 15.0 }, { n: "Large", p: 18.0 }] }
      ] },
    { id: "433FBT50JEVY8", name: "Pork Ribs", emoji: "🍖",
        desc: "Pork ribs with two sides", base: 18.0, lo: 18.0, hi: 18.0, prepMinutes: 15, search: "pork ribs", groups: [
        { gid: "YQWN3PKBKV9NG", name: "Side With Meal", kind: "side", mods: [{ n: "White Rice", p: 0.0 }, { n: "Mac And Cheese", p: 0.0 }, { n: "Rice And Peas", p: 0.0 }, { n: "Fried Chicken", p: 6.0 }, { n: "Festival", p: 0.0 }, { n: "Pasta", p: 0.0 }, { n: "Shrimp", p: 5.0 }, { n: "Whiting Fish X1", p: 2.5 }, { n: "Mashed Potatoes", p: 0.0 }, { n: "Waffles", p: 0.0 }, { n: "Seafood Mac", p: 3.5 }, { n: "Candied Yams", p: 0.0 }, { n: "Steam Veg.", p: 0.0 }, { n: "Plaintain", p: 0.0 }] }
      ] },
    { id: "QFNQ2XQB8SPN6", name: "Fried chicken", emoji: "🍗",
        desc: "Fried to order, medium or large", base: 0.0, lo: 13.0, hi: 16.0, prepMinutes: 15, search: "fried chicken medium large", groups: [
        { gid: "BKRVMPSXZR0G0", name: "Fried Chicken", kind: "variant", mods: [{ n: "Medium", p: 13.0 }, { n: "Large", p: 16.0 }] },
        { gid: "YQWN3PKBKV9NG", name: "Side With Meal", kind: "side", mods: [{ n: "White Rice", p: 0.0 }, { n: "Mac And Cheese", p: 0.0 }, { n: "Rice And Peas", p: 0.0 }, { n: "Fried Chicken", p: 6.0 }, { n: "Festival", p: 0.0 }, { n: "Pasta", p: 0.0 }, { n: "Shrimp", p: 5.0 }, { n: "Whiting Fish X1", p: 2.5 }, { n: "Mashed Potatoes", p: 0.0 }, { n: "Waffles", p: 0.0 }, { n: "Seafood Mac", p: 3.5 }, { n: "Candied Yams", p: 0.0 }, { n: "Steam Veg.", p: 0.0 }, { n: "Plaintain", p: 0.0 }] }
      ] },
    { id: "SJGN0N254K8KE", name: "Jerk Chicken", emoji: "🍗",
        desc: "Jerk chicken with two sides", base: 0.0, lo: 14.0, hi: 16.0, prepMinutes: 15, search: "jerk chicken medium large", groups: [
        { gid: "NMMJZB5VVMGNJ", name: "Jerk Chicken", kind: "variant", mods: [{ n: "Medium", p: 14.0 }, { n: "Large", p: 16.0 }] },
        { gid: "YQWN3PKBKV9NG", name: "Side With Meal", kind: "side", mods: [{ n: "White Rice", p: 0.0 }, { n: "Mac And Cheese", p: 0.0 }, { n: "Rice And Peas", p: 0.0 }, { n: "Fried Chicken", p: 6.0 }, { n: "Festival", p: 0.0 }, { n: "Pasta", p: 0.0 }, { n: "Shrimp", p: 5.0 }, { n: "Whiting Fish X1", p: 2.5 }, { n: "Mashed Potatoes", p: 0.0 }, { n: "Waffles", p: 0.0 }, { n: "Seafood Mac", p: 3.5 }, { n: "Candied Yams", p: 0.0 }, { n: "Steam Veg.", p: 0.0 }, { n: "Plaintain", p: 0.0 }] }
      ] },
    { id: "1PBGJ1BWC3Z52", name: "Chicken & Waffles", emoji: "🧇",
        desc: "Fried chicken over waffles, six flavors", base: 15.0, lo: 15.0, hi: 15.0, prepMinutes: 15, search: "chicken waffles red velvet strawberry easter bun cinnamin buttermilk coconut toto", groups: [
        { gid: "YQWN3PKBKV9NG", name: "Side With Meal", kind: "side", mods: [{ n: "White Rice", p: 0.0 }, { n: "Mac And Cheese", p: 0.0 }, { n: "Rice And Peas", p: 0.0 }, { n: "Fried Chicken", p: 6.0 }, { n: "Festival", p: 0.0 }, { n: "Pasta", p: 0.0 }, { n: "Shrimp", p: 5.0 }, { n: "Whiting Fish X1", p: 2.5 }, { n: "Mashed Potatoes", p: 0.0 }, { n: "Waffles", p: 0.0 }, { n: "Seafood Mac", p: 3.5 }, { n: "Candied Yams", p: 0.0 }, { n: "Steam Veg.", p: 0.0 }, { n: "Plaintain", p: 0.0 }] },
        { gid: "3VQCJ6J8Q465P", name: "Waffles Flavors", kind: "flavor", mods: [{ n: "Red Velvet", p: 0.0 }, { n: "Strawberry", p: 0.0 }, { n: "Easter Bun", p: 0.0 }, { n: "Cinnamin", p: 0.0 }, { n: "Buttermilk", p: 0.0 }, { n: "Coconut Toto", p: 0.0 }] }
      ] },
    { id: "VTKZ1S1K3GPK8", name: "Brown Stew Chicken", emoji: "🍛",
        desc: "Chicken braised down in brown stew gravy", base: 0.0, lo: 13.0, hi: 15.0, prepMinutes: 15, search: "brown stew chicken medium large", groups: [
        { gid: "0EJWT5G5T0HNG", name: "Brown Stew Chicken", kind: "variant", mods: [{ n: "Medium", p: 13.0 }, { n: "Large", p: 15.0 }] },
        { gid: "YQWN3PKBKV9NG", name: "Side With Meal", kind: "side", mods: [{ n: "White Rice", p: 0.0 }, { n: "Mac And Cheese", p: 0.0 }, { n: "Rice And Peas", p: 0.0 }, { n: "Fried Chicken", p: 6.0 }, { n: "Festival", p: 0.0 }, { n: "Pasta", p: 0.0 }, { n: "Shrimp", p: 5.0 }, { n: "Whiting Fish X1", p: 2.5 }, { n: "Mashed Potatoes", p: 0.0 }, { n: "Waffles", p: 0.0 }, { n: "Seafood Mac", p: 3.5 }, { n: "Candied Yams", p: 0.0 }, { n: "Steam Veg.", p: 0.0 }, { n: "Plaintain", p: 0.0 }] }
      ] },
    { id: "9WV3BMMSC8G5E", name: "Soup", emoji: "🥣",
        desc: "Chicken, goat, or seafood", base: 0.0, lo: 5.0, hi: 15.0, prepMinutes: 15, search: "soup medium chicken large goat seafood", groups: [
        { gid: "H2749PVKFN4EY", name: "Soup", kind: "variant", mods: [{ n: "Medium Chicken", p: 5.0 }, { n: "Large Chicken", p: 10.0 }, { n: "Medium Goat", p: 5.0 }, { n: "Large Goat", p: 10.0 }, { n: "Medium Seafood", p: 10.0 }, { n: "Large Seafood", p: 15.0 }] }
      ] },
    { id: "6NX7XK602V0ZM", name: "Side", emoji: "🍚",
        desc: "One side on its own", base: 0.0, lo: 1.0, hi: 15.0, prepMinutes: 15, noPrep: true, search: "side mac cheese seafood rice peas white fried chicken mashed potatoes steam veggies festival pasta shrimp x1 breast whiting fish waffles candied yams corn bread jerk plantain 1 piece pepper", groups: [
        { gid: "S032100JQ3P4T", name: "Side", kind: "variant", mods: [{ n: "Mac & Cheese", p: 6.0 }, { n: "Seafood Mac & Cheese", p: 8.0 }, { n: "Rice & Peas", p: 5.0 }, { n: "White Rice", p: 5.0 }, { n: "Fried Chicken", p: 6.0 }, { n: "Mashed Potatoes", p: 5.0 }, { n: "Steam Veggies", p: 3.0 }, { n: "Festival", p: 1.0 }, { n: "Pasta", p: 10.0 }, { n: "Shrimp X1", p: 2.0 }, { n: "Chicken Breast", p: 5.0 }, { n: "Shrimp", p: 5.0 }, { n: "Whiting Fish  X1", p: 2.5 }, { n: "Chicken Mac & Cheese", p: 7 }, { n: "Waffles", p: 8.0 }, { n: "Candied Yams", p: 5.0 }, { n: "Corn Bread", p: 1.5 }, { n: "Jerk Chicken", p: 6.0 }, { n: "Plantain", p: 3.0 }, { n: "Fried Chicken (1 Piece)", p: 2.0 }, { n: "Pepper Shrimp", p: 15.0 }] }
      ] },
    { id: "KW21XBQ6XVTGA", name: "Lunch Specials", emoji: "☀️",
        desc: "Smaller plates at lunch prices", base: 0.0, lo: 2.0, hi: 8.0, prepMinutes: 15, search: "lunch specials curried chicken fried jerk stew extra side", groups: [
        { gid: "F0Q8615QD5HMM", name: "Lunch Specials", kind: "variant", mods: [{ n: "Curry Goat", p: 12.0, oos: true }, { n: "Curried Chicken", p: 8 }, { n: "Fried Chicken", p: 8 }, { n: "Jerk Chicken", p: 8 }, { n: "Oxtail", p: 13.5, oos: true }, { n: "Stew Chicken", p: 8 }, { n: "Wings", p: 10.5, oos: true }, { n: "Extra Side", p: 2.0 }] }
      ] },
  ]},
  { cat: "Seafood Fridays", sub: "Fridays only", items: [
    { id: "BRMP82TR0Z45C", name: "Crab Legs Platter (Shrimp & 2 Sides)", emoji: "🦀",
        desc: "Crab legs with shrimp and two sides", days: [5], base: 39.99, lo: 39.99, hi: 39.99, prepMinutes: 30, search: "crab legs platter shrimp 2 sides", groups: [
      ] },
    { id: "A1YZ2ZD5CA1SW", name: "Lobster Platter (Shrimp & 2 Sides)", emoji: "🦞",
        desc: "Lobster with shrimp and two sides", days: [5], base: 39.99, lo: 39.99, hi: 39.99, prepMinutes: 30, search: "lobster platter shrimp 2 sides", groups: [
      ] },
    { id: "06Z80836S0GZR", name: "Fish Platter (Shrimp & 2 Sides)", emoji: "🐠",
        desc: "Fish with shrimp and two sides", days: [5], base: 30.0, lo: 30.0, hi: 30.0, prepMinutes: 30, search: "fish platter shrimp 2 sides", groups: [
      ] },
    { id: "CAFAH5FKPTRW8", name: "Shrimp", emoji: "🍤",
        desc: "Shrimp with two sides", days: [5], base: 21.99, lo: 21.99, hi: 21.99, prepMinutes: 30, search: "shrimp", groups: [
      ] },
    { id: "0NQ5E11VABFDY", name: "Salmon (Shrimp & 2 Sides)", emoji: "🍽️",
        desc: "Salmon with shrimp and two sides", days: [5], base: 21.99, lo: 21.99, hi: 21.99, prepMinutes: 30, search: "salmon shrimp 2 sides", groups: [
      ] },
  ]},
  { cat: "Drinks", sub: "Refreshing beverages", items: [
    { id: "EWT1J5Q9K7KX0", name: "Pina Colada", emoji: "🍹",
        desc: "Mango, pina colada, or mixed", base: 0.0, lo: 5.0, hi: 12.5, prepMinutes: 15, noPrep: true, search: "pina colada small mango mix large", groups: [
        { gid: "EQ6H6770BBG7R", name: "Pina Colada", kind: "variant", mods: [{ n: "Small (Mango)", p: 5.0 }, { n: "Small (Pina Colada)", p: 7.0 }, { n: "Small Mix", p: 10.0 }, { n: "Large (Mango)", p: 7.0 }, { n: "Large (Pina colada)", p: 9.5 }, { n: "Large (Mix)", p: 12.5 }] }
      ] },
    { id: "D7MBX5PWRCGCE", name: "Drink", emoji: "🥤",
        desc: "Sodas, juices, and coconut water", base: 0.0, lo: 1.0, hi: 6.0, prepMinutes: 15, noPrep: true, search: "drink d g jamaica soda tropical rhythm water coconut snapple ting pepsi cranberry wata can arizona bottled tru juice natural box large red bull small ree", groups: [
        { gid: "FT5JBR312DVTA", name: "Drink", kind: "variant", mods: [{ n: "D & G Jamaica Soda", p: 3.0 }, { n: "Tropical Rhythm", p: 3.0 }, { n: "Water", p: 1.5 }, { n: "Coconut Water", p: 6.0 }, { n: "Snapple", p: 2.0 }, { n: "Ting", p: 3.0 }, { n: "Pepsi", p: 2.5 }, { n: "Cranberry Wata", p: 2.0 }, { n: "Can Arizona", p: 1.0 }, { n: "Bottled Arizona", p: 1.25 }, { n: "Tru Juice", p: 4.0 }, { n: "Natural Juice", p: 5.0 }, { n: "Tru Juice (Box)", p: 3.0 }, { n: "Large Can Soda", p: 1.5 }, { n: "Red Bull (Small)", p: 3.5 }, { n: "Ree Bull (Large)", p: 5.0 }] }
      ] },
  ]},
];
/* Uber Eats prices verified 2026-07-25, keyed to Clover item ids.
   Used only to show customers what ordering direct saves them. */
export const UE = {
  "60KCQ1V22Q98M": 24,    // Oxtail
  "7916EWVQFPGH8": 36,    // Lamb
  "NEAR47KAE44HC": 18,    // Curried Goat
  "C2RD25C1VXNN0": 18,    // Wings
  "SJGN0N254K8KE": 16.80, // Jerk Chicken
  "QFNQ2XQB8SPN6": 15.60, // Fried Chicken
  "H9520PFNBT2NY": 24,    // Salmon
  "VHHCS7EDV70HC": 24,    // Shrimp
};

// Special ids used for reward eligibility
export const DRINK_ID = "D7MBX5PWRCGCE";
export const SIDE_ID  = "6NX7XK602V0ZM";

// The six on the website's "What We're Known For". The Popular section in the
// app renders these same item objects — it does not copy them.
export const POPULAR_IDS = [
  "60KCQ1V22Q98M", // Oxtail
  "SJGN0N254K8KE", // Jerk Chicken
  "C2RD25C1VXNN0", // Wings
  "H9520PFNBT2NY", // Salmon — honey garlic
  "QFNQ2XQB8SPN6", // Fried Chicken
  "VHHCS7EDV70HC", // Shrimp — sweet chilli
];

/* Prep-time constants travel with the data so src/lib/prep.js has a single
   source for them and never re-declares a number the generator owns. */
export const DEFAULT_PREP_MINUTES = 15;
export const COOKED_TO_ORDER_MINUTES = 30;

export const CAT_OF = {};
export const PLATE_IDS = new Set();   // anything served with two sides
MENU.forEach((c) => c.items.forEach((i) => {
  CAT_OF[i.id] = c.cat;
  if (i.groups.some((g) => g.kind === "side")) PLATE_IDS.add(i.id);
}));
export const hasChoices = (i) => i.groups.length > 0;
