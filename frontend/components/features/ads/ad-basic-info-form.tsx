"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/contexts/i18n-context";

import type { UseFormRegister } from "react-hook-form";

interface AdBasicInfoFormProps {
  register: UseFormRegister<Record<string, unknown>>;
  errors: Record<string, { message?: string }>;
}

export function AdBasicInfoForm({ register, errors }: AdBasicInfoFormProps) {
  const { t } = useI18n();
  return (
    <div className="space-y-6">
      <div>
        <Label htmlFor="title" className="text-base font-semibold text-blue-600 dark:text-blue-400">
          {t('ad.title','Title')}
        </Label>
        <Input
          id="title"
          {...register("title")}
          placeholder={t('ad.title.placeholder','E.g., Selling a gently used iPhone 13')}
          className="mt-2 bg-white dark:bg-gray-950 border-0 ring-1 ring-blue-200/50 dark:ring-blue-900/30 focus:ring-2 focus:ring-blue-500 focus:border-0 placeholder-gray-400 focus:shadow-[0_0_0_4px_rgba(59,130,246,0.1)] dark:focus:shadow-[0_0_0_4px_rgba(59,130,246,0.1)] transition-shadow duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        />
        {errors?.title && (
          <p className="mt-2 text-sm text-red-500">{errors.title.message}</p>
        )}
      </div>

      <div>
        <Label htmlFor="description" className="text-base font-semibold text-blue-600 dark:text-blue-400">
          {t('ad.description','Description')}
        </Label>
        <Textarea
          id="description"
          {...register("description")}
          placeholder={t('ad.description.placeholder','Provide detailed information about your advertisement')}
          className="mt-2 h-32 bg-white dark:bg-gray-950 border-0 ring-1 ring-blue-200/50 dark:ring-blue-900/30 focus:ring-2 focus:ring-blue-500 focus:border-0 resize-none placeholder-gray-400 focus:shadow-[0_0_0_4px_rgba(59,130,246,0.1)] dark:focus:shadow-[0_0_0_4px_rgba(59,130,246,0.1)] transition-shadow duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        />
        {errors?.description && (
          <p className="mt-2 text-sm text-red-500">{errors.description.message}</p>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <Label htmlFor="price" className="text-base font-semibold text-blue-600 dark:text-blue-400">
            {t('ad.price.set','Set Price')}
          </Label>
          <Input
            id="price"
            {...register("price")}
            placeholder={t('ad.price.placeholder','Enter price (e.g., 300€)')}
            className="mt-2 bg-white dark:bg-gray-950 border-0 ring-1 ring-blue-200/50 dark:ring-blue-900/30 focus:ring-2 focus:ring-blue-500 focus:border-0 placeholder-gray-400 focus:shadow-[0_0_0_4px_rgba(59,130,246,0.1)] dark:focus:shadow-[0_0_0_4px_rgba(59,130,246,0.1)] transition-shadow duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          />
          {errors?.price && (
            <p className="mt-2 text-sm text-red-500">{errors.price.message}</p>
          )}
        </div>
        <div>
          <Label htmlFor="contactNumber" className="text-base font-semibold text-blue-600 dark:text-blue-400">
            {t('ad.contactNumber','Contact Number')}
          </Label>
          <Input
            id="contactNumber"
            {...register("contactNumber")}
            placeholder="+1 (555) 000-0000"
            type="tel"
            className="mt-2 bg-white dark:bg-gray-950 border-0 ring-1 ring-blue-200/50 dark:ring-blue-900/30 focus:ring-2 focus:ring-blue-500 focus:border-0 placeholder-gray-400 focus:shadow-[0_0_0_4px_rgba(59,130,246,0.1)] dark:focus:shadow-[0_0_0_4px_rgba(59,130,246,0.1)] transition-shadow duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          />
          {errors?.contactNumber && (
            <p className="mt-2 text-sm text-red-500">{errors.contactNumber.message}</p>
          )}
        </div>
      </div>
    </div>
  )
}
