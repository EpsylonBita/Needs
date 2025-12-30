import { z } from 'zod'

import { profileSchema, listingSchema, paymentSchema, milestoneSchema } from '@/lib/validations/db-schema'
import { getSupabaseAdmin } from './server'

import type { Profile, Listing, Payment, Milestone } from '@/types/db'

function validateRow<T>(schema: z.ZodType<T>, row: unknown): T {
  return schema.parse(row)
}

export async function getProfileByUserId(userId: string): Promise<Profile> {
  const db = getSupabaseAdmin()
  const { data, error } = await db.from('profiles').select('*').eq('user_id', userId).single()
  if (error || !data) throw new Error('Profile not found')
  return validateRow(profileSchema, data)
}

export async function getListingActiveById(listingId: string): Promise<Listing> {
  const db = getSupabaseAdmin()
  const { data, error } = await db.from('listings').select('*').eq('id', listingId).eq('status', 'active').single()
  if (error || !data) throw new Error('Listing not found or unavailable')
  return listingSchema.parse(data) as Listing
}

export async function getSellerProfile(profileId: string): Promise<Profile> {
  const db = getSupabaseAdmin()
  const { data, error } = await db.from('profiles').select('*').eq('id', profileId).single()
  if (error || !data) throw new Error('Seller not set up for payments')
  return validateRow(profileSchema, data)
}

export async function getPaymentByIntent(intentId: string): Promise<Payment> {
  const db = getSupabaseAdmin()
  const { data, error } = await db.from('payments').select('*').eq('stripe_payment_intent', intentId).single()
  if (error || !data) throw new Error('Payment not found for intent')
  return validateRow(paymentSchema, data)
}

export async function insertPayment(row: Omit<Payment, 'id' | 'created_at'>): Promise<void> {
  const db = getSupabaseAdmin()
  await db.from('payments').insert(row)
}

export async function getMilestoneById(id: string): Promise<Milestone> {
  const db = getSupabaseAdmin()
  const { data, error } = await db.from('milestones').select('*').eq('id', id).single()
  if (error || !data) throw new Error('Milestone not found')
  return validateRow(milestoneSchema, data)
}
