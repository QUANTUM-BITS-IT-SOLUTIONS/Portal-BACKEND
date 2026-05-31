import prisma from "../lib/prisma";

/**
 * Seed Partner Tiers with the correct commission structure:
 * - Bronze: 5% for earnings 0-50,000
 * - Silver: 7.5% for earnings 50,001-100,000
 * - Gold: 10% for earnings > 100,000
 */
async function seedTiers() {
    console.log("Seeding partner tiers...");

    const tiers = [
        {
            name: "Bronze",
            minRevenue: 0,
            commissionPercentage: 5,
            color: "#CD7F32", // Bronze color
            icon: "Medal",
            benefits: ["5% commission on all referrals", "Basic partner support"],
            sortOrder: 1,
        },
        {
            name: "Silver",
            minRevenue: 50001,
            commissionPercentage: 7.5,
            color: "#C0C0C0", // Silver color
            icon: "Award",
            benefits: ["7.5% commission on all referrals", "Priority support", "Monthly performance reports"],
            sortOrder: 2,
        },
        {
            name: "Gold",
            minRevenue: 100001,
            commissionPercentage: 10,
            color: "#FFD700", // Gold color
            icon: "Trophy",
            benefits: ["10% commission on all referrals", "VIP support", "Exclusive partner events", "Custom referral materials"],
            sortOrder: 3,
        },
    ];

    for (const tier of tiers) {
        await prisma.partnerTier.upsert({
            where: { name: tier.name },
            update: {
                minRevenue: tier.minRevenue,
                commissionPercentage: tier.commissionPercentage,
                color: tier.color,
                icon: tier.icon,
                benefits: tier.benefits,
                sortOrder: tier.sortOrder,
                isActive: true,
            },
            create: {
                name: tier.name,
                minRevenue: tier.minRevenue,
                commissionPercentage: tier.commissionPercentage,
                color: tier.color,
                icon: tier.icon,
                benefits: tier.benefits,
                sortOrder: tier.sortOrder,
                isActive: true,
            },
        });
        console.log(`✅ Tier "${tier.name}" seeded with ${tier.commissionPercentage}% commission (min: ₹${tier.minRevenue})`);
    }

    console.log("Partner tiers seeding complete!");
}

seedTiers()
    .catch((e) => {
        console.error("Error seeding tiers:", e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
