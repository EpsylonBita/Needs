"use client"

import { useFormContext } from "react-hook-form"


import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useI18n } from '@/contexts/i18n-context'
 
import type { UseFormRegister } from "react-hook-form"

type FormValues = {
  title: string
  description: string
  price?: string
  contactNumber: string
  subcategory?: string
}

interface AdBasicInfoFormProps {
  register: UseFormRegister<FormValues>
  errors: Partial<Record<'title'|'description'|'price'|'contactNumber', { message?: string }>>
}

/**
 * Basic information form section for ad creation
 * Handles title, description, price, and contact number
 */
export function AdBasicInfoForm({ register, errors }: AdBasicInfoFormProps) {
  const { t } = useI18n()
  const { watch } = useFormContext<FormValues>()
  
  const selectedSubcategory = watch('subcategory')
  const isService = selectedSubcategory === 'I can' || selectedSubcategory === 'I will'

  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="title" className="text-base font-semibold text-blue-600 dark:text-blue-400">
          {t('ad.title','Title')}
        </Label>
        <Input
          id="title"
          placeholder={t('ad.title.placeholder','What are you offering or looking for?')}
          {...register('title')}
          className={errors.title ? "border-red-500" : ""}
        />
        {errors.title && (
          <p className="text-red-500 text-sm mt-1">{errors.title.message}</p>
        )}
      </div>

      <div>
        <Label htmlFor="description" className="text-base font-semibold text-blue-600 dark:text-blue-400">
          {t('ad.description','Description')}
        </Label>
        <Textarea
          id="description"
          placeholder={t('ad.description.placeholder','Describe your item or service in detail...')}
          rows={4}
          {...register('description')}
          className={errors.description ? "border-red-500" : ""}
        />
        {errors.description && (
          <p className="text-red-500 text-sm mt-1">{errors.description.message}</p>
        )}
      </div>

      {!isService && (
        <div>
          <Label htmlFor="price" className="text-base font-semibold text-blue-600 dark:text-blue-400">
            {t('ad.price','Price (€)')}
          </Label>
          <Input
            id="price"
            type="number"
            step="0.01"
            min="0"
            placeholder="0.00"
            {...register('price')}
            className={errors.price ? "border-red-500" : ""}
          />
          {errors.price && (
            <p className="text-red-500 text-sm mt-1">{errors.price.message}</p>
          )}
        </div>
      )}

      <div>
        <Label htmlFor="contactNumber" className="text-base font-semibold text-blue-600 dark:text-blue-400">
          {t('ad.contact','Contact Number')}
        </Label>
        <Input
          id="contactNumber"
          type="tel"
          placeholder={t('ad.contact.placeholder','Your contact phone number')}
          {...register('contactNumber')}
          className={errors.contactNumber ? "border-red-500" : ""}
        />
        {errors.contactNumber && (
          <p className="text-red-500 text-sm mt-1">{errors.contactNumber.message}</p>
        )}
      </div>
    </div>
  )
}
