import type { BusinessProfileInput } from "../validators/businessProfile";

export type StoredBusinessProfile = BusinessProfileInput & {
  id: string;
  updatedAt: number;
};

const profileStore = new Map<string, StoredBusinessProfile>();

export const saveBusinessProfile = (
  userId: string,
  profile: BusinessProfileInput
): StoredBusinessProfile => {
  const normalized: BusinessProfileInput = {
    category: profile.category,
    subType: profile.subType,
    customType: profile.customType?.trim() || null,
    businessName: profile.businessName?.trim() || null,
  };

  const record: StoredBusinessProfile = {
    ...normalized,
    id: userId,
    updatedAt: Date.now(),
  };

  profileStore.set(userId, record);
  return record;
};

export const getBusinessProfile = (userId: string): StoredBusinessProfile | null => {
  return profileStore.get(userId) ?? null;
};
