import { z } from 'zod'

export const profileSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  display_name: z.string().nullable(),
  avatar_url: z.string().url().nullable(),
  reputation: z.number(),
  rating_count: z.number(),
  title: z.string().nullable().optional(),
  bio: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  cover_image: z.string().url().nullable().optional(),
  created_at: z.string()
})

export const listingSchema = z.object({
  id: z.string(),
  seller_id: z.string(),
  title: z.string().min(1),
  description: z.string().min(1),
  price: z.number().nonnegative(),
  main_category: z.enum(['Items', 'Services']),
  sub_category: z.enum(['Buy', 'Sell', 'Free', 'I want', 'I will', 'I can']),
  status: z.enum(['active', 'sold', 'suspended']),
  location: z.any().nullable(),
  address: z.record(z.any()).nullable(),
  created_at: z.string()
})

export const listingImageSchema = z.object({
  id: z.string(),
  listing_id: z.string(),
  url: z.string().url(),
  main: z.boolean()
})

export const listingTagSchema = z.object({
  listing_id: z.string(),
  tag: z.string()
})

export const chatSchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  type: z.enum(['direct', 'group']),
  created_at: z.string()
})

export const chatParticipantSchema = z.object({
  chat_id: z.string(),
  user_id: z.string(),
  last_read_at: z.string().nullable()
})

export const messageSchema = z.object({
  id: z.string(),
  chat_id: z.string(),
  sender_id: z.string(),
  content: z.string().nullable(),
  attachments: z.record(z.any()).nullable(),
  reply_to: z.string().nullable(),
  created_at: z.string()
})

export const paymentSchema = z.object({
  id: z.string(),
  listing_id: z.string(),
  buyer_id: z.string(),
  seller_id: z.string(),
  amount: z.number().nonnegative(),
  platform_fee: z.number().nonnegative(),
  stripe_payment_intent: z.string().nullable(),
  status: z.enum(['requires_capture', 'completed', 'refunded', 'failed']),
  buyer_confirmed: z.boolean(),
  seller_confirmed: z.boolean(),
  completed_at: z.string().nullable().optional(),
  failed_at: z.string().nullable().optional(),
  refunded_at: z.string().nullable().optional(),
  disputed_at: z.string().nullable().optional(),
  created_at: z.string()
})

export const transactionSchema = z.object({
  id: z.string(),
  payment_id: z.string(),
  type: z.enum(['charge', 'transfer', 'refund']),
  amount: z.number().nonnegative(),
  fee: z.number().nonnegative().optional(),
  metadata: z.record(z.any()).nullable().optional(),
  status: z.string(),
  created_at: z.string()
})

export const disputeSchema = z.object({
  id: z.string(),
  payment_id: z.string(),
  reason: z.string().nullable(),
  amount: z.number().nonnegative().optional(),
  stripe_dispute_id: z.string().nullable().optional(),
  status: z.enum(['open', 'resolved', 'refunded', 'rejected']),
  created_at: z.string()
})

export const reviewSchema = z.object({
  id: z.string(),
  listing_id: z.string(),
  seller_id: z.string(),
  reviewer_id: z.string(),
  rating: z.number().min(1).max(5),
  comment: z.string().nullable(),
  votes: z.record(z.any()),
  created_at: z.string()
})

export const notificationSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  type: z.string(),
  payload: z.record(z.any()).nullable(),
  read: z.boolean(),
  created_at: z.string()
})

export const milestoneSchema = z.object({
  id: z.string(),
  listing_id: z.string(),
  buyer_id: z.string(),
  seller_id: z.string(),
  title: z.string(),
  amount: z.number().nonnegative(),
  status: z.enum(['pending', 'requires_capture', 'completed', 'failed']),
  stripe_payment_intent: z.string().nullable(),
  buyer_confirmed: z.boolean(),
  seller_confirmed: z.boolean(),
  completed_at: z.string().nullable().optional(),
  created_at: z.string()
})

export const webhookEventSchema = z.object({
  id: z.string(),
  source: z.string().optional(),
  event_type: z.string().optional(),
  payload: z.record(z.any()).nullable().optional(),
  processed_at: z.string().nullable().optional(),
  processing_result: z.record(z.any()).nullable().optional(),
  processing_error: z.record(z.any()).nullable().optional(),
  created_at: z.string()
})

export type Profile = z.infer<typeof profileSchema>
export type Listing = z.infer<typeof listingSchema>
export type ListingImage = z.infer<typeof listingImageSchema>
export type ListingTag = z.infer<typeof listingTagSchema>
export type Chat = z.infer<typeof chatSchema>
export type ChatParticipant = z.infer<typeof chatParticipantSchema>
export type Message = z.infer<typeof messageSchema>
export type Payment = z.infer<typeof paymentSchema>
export type Transaction = z.infer<typeof transactionSchema>
export type Dispute = z.infer<typeof disputeSchema>
export type Review = z.infer<typeof reviewSchema>
export type Notification = z.infer<typeof notificationSchema>
export type Milestone = z.infer<typeof milestoneSchema>
export type WebhookEvent = z.infer<typeof webhookEventSchema>
