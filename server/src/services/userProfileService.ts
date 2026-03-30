import prisma from '../db/prisma';

/**
 * UserProfileService — manages user personalization settings.
 * These get injected into the system prompt so the AI adapts to each user.
 */

export interface UserProfile {
  jobDescription: string | null;
  city: string | null;
  contactNumber: string | null;
  aboutMe: string | null;
  instructions: string | null;
  tonePreference: string | null;
}

export async function getUserProfile(userId: number): Promise<UserProfile | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      jobDescription: true,
      city: true,
      contactNumber: true,
      aboutMe: true,
      instructions: true,
      tonePreference: true,
    },
  });

  if (!user) return null;

  if (!user.jobDescription && !user.city && !user.contactNumber && !user.aboutMe && !user.instructions && !user.tonePreference) {
    return null;
  }

  return user;
}

export async function updateUserProfile(userId: number, data: Partial<UserProfile>): Promise<UserProfile> {
  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      jobDescription: data.jobDescription !== undefined ? data.jobDescription : undefined,
      city: data.city !== undefined ? data.city : undefined,
      contactNumber: data.contactNumber !== undefined ? data.contactNumber : undefined,
      aboutMe: data.aboutMe !== undefined ? data.aboutMe : undefined,
      instructions: data.instructions !== undefined ? data.instructions : undefined,
      tonePreference: data.tonePreference !== undefined ? data.tonePreference : undefined,
    },
    select: {
      jobDescription: true,
      city: true,
      contactNumber: true,
      aboutMe: true,
      instructions: true,
      tonePreference: true,
    },
  });

  return user;
}
