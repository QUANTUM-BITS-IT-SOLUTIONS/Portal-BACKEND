import prisma from "../lib/prisma";

export async function updateStudentTier(studentId: string) {
    try {
        // 1. Calculate total commission (earnings)
        const commissionAgg = await prisma.ledgerEntry.aggregate({
            where: {
                studentId,
                type: "student_commission",
            },
            _sum: {
                amount: true,
            },
        });

        const totalEarnings = Number(commissionAgg._sum.amount) || 0;

        // 2. Fetch all tiers, sorted by minRevenue descending
        const tiers = await prisma.partnerTier.findMany({
            orderBy: { minRevenue: "desc" },
        });

        // 3. Find the highest tier the student qualifies for
        // "Take commission as min revenue" means we compare totalEarnings vs tier.minRevenue
        let eligibleTier = null;
        for (const tier of tiers) {
            if (totalEarnings >= Number(tier.minRevenue)) {
                eligibleTier = tier;
                break;
            }
        }

        // 4. Update student if tier changed
        if (eligibleTier) {
            await prisma.student.update({
                where: { id: studentId },
                data: {
                    partnerTierId: eligibleTier.id,
                    commissionPercent: Number(eligibleTier.commissionPercentage)
                },
            });
        } else {
            // Fallback to lowest tier if exists (optional, or leave as null/default)
            // Usually there is a base tier with 0 minRevenue.
        }

        return eligibleTier;
    } catch (error) {
        console.error("Error updating student tier:", error);
    }
}
