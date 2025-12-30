"use client"

import { useEffect } from "react"

import { AlertTriangle, Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { useI18n } from '@/contexts/i18n-context'
import { useAdFormState } from '@/hooks/use-ad-form-state'
import { createListing } from '@/lib/services/listing-service'
import { uploadListingImages } from '@/lib/services/storage-service'
import { witService } from '@/lib/services/wit-service'
import { supabase } from '@/lib/supabase/client'
 

import { AdBasicInfoForm } from './ad-basic-info-form-standalone'
import { AiExtractPanel } from './ai-extract-panel'
import { CategoryTagsPicker } from './category-tags-picker'
import { ImageUploader } from './image-uploader'
import { LocationPicker } from './location-picker'

type CreateAdFormValues = {
  title: string
  description: string
  price?: string
  category: string
  subcategory: string
  location?: string
  tags?: string[]
}

interface CreateAdDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Simplified create ad dialog that delegates to smaller, focused components
 * This replaces the massive 674-line component with a clean, maintainable structure
 */
export function CreateAdDialog({ open, onOpenChange }: CreateAdDialogProps) {
  const { t } = useI18n()
  const {
    // Form state
    form: _form,
    register,
    handleSubmit,
    setValue,
    watch: _watch,
    errors,
    getValues: _getValues,
    
    // UI state
    imageFiles,
    imagePreviews,
    isSubmitting,
    setIsSubmitting,
    showMap,
    setShowMap,
    coordinates,
    locationName,
    setLocationName,
    isLocating,
    selectedCategory,
    selectedSubcategory,
    selectedTags,
    suggestedTags: _suggestedTags,
    isLoadingTags,
    openCategory: _openCategory,
    setOpenCategory: _setOpenCategory,
    openSubcategory: _openSubcategory,
    setOpenSubcategory: _setOpenSubcategory,
    nlpInput,
    setNlpInput,
    isAnalyzing,
    setIsAnalyzing,
    analysis,
    setAnalysis,
    analysisSuccess,
    setAnalysisSuccess,
    analysisError,
    setAnalysisError,
    onboardRequired,
    setOnboardRequired: _setOnboardRequired,
    
    // Actions
    resetForm,
    handleImageChange,
    removeImage,
    handleCategorySelect,
    handleSubcategorySelect,
    toggleTag,
    fetchAISuggestions: _fetchAISuggestions,
    checkOnboarding
  } = useAdFormState()

  // Reset form when dialog closes
  useEffect(() => {
    if (!open) {
      resetForm()
    }
  }, [open, resetForm])

  // Check onboarding status when dialog opens
  useEffect(() => {
    if (open) {
      checkOnboarding()
    }
  }, [open, checkOnboarding])

  const onSubmit = async (data: CreateAdFormValues) => {
    if (onboardRequired) {
      return
    }

    setIsSubmitting(true)
    
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')

      const { data: profile } = await supabase
        .from('profiles')
        .select('id')
        .eq('user_id', user.id)
        .limit(1)
        .single()

      if (!profile) throw new Error('Profile not found')

      // Upload images first
      let imageUrls: string[] = []
      

      // Create listing
      const listingData = {
        seller_id: profile.id,
        title: data.title,
        description: data.description,
        price: data.price ? parseFloat(data.price) : 0,
        main_category: data.category as 'Items' | 'Services',
        sub_category: data.subcategory as 'Buy' | 'Sell' | 'Free' | 'I want' | 'I will' | 'I can',
        location: coordinates ? `POINT(${coordinates[0]} ${coordinates[1]})` : null,
        address: locationName ? { name: locationName } : null,
        tags: selectedTags,
        images: imageUrls
      }

      const result = await createListing(listingData)
      
      if (imageFiles.length > 0 && result?.id) {
        await uploadListingImages(result.id, imageFiles)
      }
      

      // Success - close dialog
      onOpenChange(false)
      
      // Show success message (handled by parent component or toast)
      
    } catch (error: unknown) {
      console.error('Failed to create listing:', error)
      // Error handling will be improved in the next task
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleNlpAnalysis = async () => {
    if (!nlpInput.trim()) return
    
    setIsAnalyzing(true)
    setAnalysisError(null)
    
    try {
      const result = await witService.analyzeText(nlpInput)
      setAnalysis({ tags: result.tags || [], smartTags: result.smartTags || [] })
      setAnalysisSuccess(true)
      
      // Auto-select some tags
      const newTags = (result.smartTags || []).slice(0, 3).filter((tag: string) => !selectedTags.includes(tag))
      if (newTags.length > 0) {
        const updatedTags = [...selectedTags, ...newTags]
        setValue('tags', updatedTags)
      }
      
      setTimeout(() => setAnalysisSuccess(false), 3000)
    } catch (error) {
      console.error('AI analysis failed:', error)
      setAnalysisError('Failed to analyze text. Please try again.')
    } finally {
      setIsAnalyzing(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] flex flex-col bg-white dark:bg-gray-950">
        <DialogHeader className="flex-none">
          <DialogTitle className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-blue-400 bg-clip-text text-transparent">
            {t('ad.create.title','Create New Advertisement')}
          </DialogTitle>
          <DialogDescription className="text-gray-500 dark:text-gray-400">
            {t('ad.create.desc','Fill in the details below to create your advertisement.')}
          </DialogDescription>
        </DialogHeader>

        {/* Error notification */}
        {analysisError && (
          <div className="fixed top-4 right-4 z-50 bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-400 px-4 py-3 rounded-md shadow-md animate-in fade-in slide-in-from-right-8 duration-300">
            <div className="flex items-center">
              <AlertTriangle className="h-5 w-5 mr-2" />
              <span>{analysisError}</span>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col flex-1 overflow-hidden">
          {onboardRequired && (
            <div className="mb-4 p-3 rounded-md bg-yellow-100 text-yellow-800">
              <div className="flex items-center justify-between">
                <span>Complete Stripe onboarding to publish listings and receive payments.</span>
                <a href="/payments/onboarding" className="ml-4 px-3 py-1 rounded-md bg-blue-600 text-white">Start Onboarding</a>
              </div>
            </div>
          )}
          
          <AiExtractPanel
            nlpInput={nlpInput}
            isAnalyzing={isAnalyzing}
            analysisSuccess={analysisSuccess}
            onChange={setNlpInput}
            onAnalyze={handleNlpAnalysis}
          />

          {/* Main content - scrollable */}
          <div className="flex-1 overflow-y-auto pr-2 space-y-6">
            <div className="space-y-6">
              <AdBasicInfoForm 
                register={register} 
                errors={errors} 
              />

              <CategoryTagsPicker
                selectedCategory={selectedCategory}
                selectedSubcategory={selectedSubcategory}
                selectedTags={selectedTags}
                analysis={analysis}
                isLoadingTags={isLoadingTags}
                onCategorySelect={handleCategorySelect}
                onSubcategorySelect={handleSubcategorySelect}
                onToggleTag={toggleTag}
                categoryError={errors.category?.message}
                subcategoryError={errors.subcategory?.message}
              />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <LocationPicker
                  locationName={locationName}
                  showMap={showMap}
                  coordinates={coordinates}
                  isLocating={isLocating}
                  errorMessage={errors.location?.message}
                  onLocationNameChange={setLocationName}
                onToggleMap={() => setShowMap(!showMap)}
                  onUseCurrentLocation={() => {/* TODO: Implement geolocation */}}
                />
              </div>

              <div>
                <Label className="text-base font-semibold text-blue-600 dark:text-blue-400">
                  {t('ad.images.upload','Upload Images')}
                </Label>
                <ImageUploader 
                  imagePreviews={imagePreviews} 
                  onRemove={removeImage} 
                  onChange={handleImageChange} 
                />
              </div>
            </div>
          </div>

          {/* Footer - fixed */}
          <div className="flex-none pt-6 mt-6 border-t border-gray-200 dark:border-gray-800">
            <div className="flex justify-end gap-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                className="border-0 ring-1 ring-gray-200 dark:ring-gray-800 hover:bg-gray-100 dark:hover:bg-gray-900 hover:ring-gray-300 dark:hover:ring-gray-700"
              >
                {t('common.cancel','Cancel')}
              </Button>
              <Button
                type="submit"
                disabled={isSubmitting || onboardRequired}
                className="bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white shadow-lg shadow-blue-500/20 hover:shadow-blue-500/30 transition-all duration-300"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    {t('ad.creating','Creating...')}
                  </>
                ) : (
                  t('ad.create.submit','Create Advertisement')
                )}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
