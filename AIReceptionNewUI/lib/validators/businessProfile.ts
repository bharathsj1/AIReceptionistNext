import { z } from "zod";

export const businessProfileSchema = z
  .object({
    category: z.string().min(1, "Category is required"),
    subType: z.string().min(1, "Sub-type is required"),
    customType: z.string().trim().optional().nullable(),
    businessName: z.string().trim().optional().nullable(),
  })
  .superRefine((data, ctx) => {
    const needsCustom =
      data.category === "Other (Custom)" || data.subType === "Other (Custom)";
    const customValue = data.customType?.trim() ?? "";

    if (needsCustom && (customValue.length < 2 || customValue.length > 60)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["customType"],
        message: "Custom type must be 2-60 characters",
      });
    }
  });

export type BusinessProfileInput = z.infer<typeof businessProfileSchema>;
