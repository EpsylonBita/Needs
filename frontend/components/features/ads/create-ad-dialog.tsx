"use client";

import { useState, useEffect, useCallback } from "react";

import { zodResolver } from "@hookform/resolvers/zod";
import { AlertTriangle, Loader2 } from "lucide-react";
import mapboxgl from 'mapbox-gl';
import { useForm } from "react-hook-form";
import * as z from "zod";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useI18n } from '@/contexts/i18n-context';
import { useMap } from '@/hooks/use-map';
import { CATEGORY_STRUCTURE } from '@/lib/constants/categories'
import { createListing } from '@/lib/services/listing-service'
import { uploadListingImages } from '@/lib/services/storage-service'
import { witService } from '@/lib/services/wit-service';
import { supabase } from '@/lib/supabase/client'
import { withCsrfHeaders } from '@/lib/utils/csrf'

import { AdBasicInfoForm } from './ad-basic-info-form'
import { AiExtractPanel } from './ai-extract-panel'
import { CategoryTagsPicker } from './category-tags-picker'
import { ImageUploader } from './image-uploader'
import { LocationPicker } from './location-picker'
 
 
const formSchema = z.object({
  title: z.string().min(3, "Title must be at least 3 characters"),
  description: z.string().min(10, "Description must be at least 10 characters"),
  category: z.string().min(1, "Please select a category"),
  subcategory: z.string().min(1, "Please select a subcategory"),
  price: z.string().optional(),
  contactNumber: z.string().min(10, "Please enter a valid contact number"),
  location: z.string().min(3, "Please enter a valid location"),
  images: z.array(z.any()).optional(),
  tags: z.array(z.string()).optional(),
});

type FormValues = z.infer<typeof formSchema>;

interface CreateAdDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateAdDialog({ open, onOpenChange }: CreateAdDialogProps) {
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [coordinates, setCoordinates] = useState<[number, number] | null>(null);
  const [locationName, setLocationName] = useState("");
  const [isLocating, setIsLocating] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string>("");
  const [selectedSubcategory, setSelectedSubcategory] = useState<string>("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [_suggestedTags, setSuggestedTags] = useState<string[]>([]);
  const [_openCategory, setOpenCategory] = useState(false);
  const [_openSubcategory, setOpenSubcategory] = useState(false);
  const [isLoadingTags, setIsLoadingTags] = useState(false);
  const [nlpInput, setNlpInput] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<{ tags: string[], smartTags: string[] }>({
    tags: [],
    smartTags: []
  });
  const [analysisSuccess, setAnalysisSuccess] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [onboardRequired, setOnboardRequired] = useState(false);

  // Use map hook
  const { map, initializeMap, updateMarker } = useMap();
  const { t } = useI18n();

  // Map initialization effect
  useEffect(() => {
    if (showMap && !map) {
      initializeMap('location-map', {
        center: coordinates || [23.7275, 37.9838], // Default to Athens
        zoom: 12,
        onClick: handleMapClick
      });
    }
  }, [showMap, map, coordinates, initializeMap]);

  // Initialize form
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      title: "",
      description: "",
      category: "",
      subcategory: "",
      price: "",
      contactNumber: "",
      location: "",
      images: [],
      tags: []
    }
  });

  const { register, handleSubmit, setValue, watch, formState: { errors }, getValues } = form;

  // Reset form when dialog is closed
  useEffect(() => {
    if (!open) {
      // Reset all state when the dialog is closed
      form.reset();
      setSelectedCategory("");
      setSelectedSubcategory("");
      setSelectedTags([]);
      setSuggestedTags([]);
      setImageFiles([]);
      setImagePreviews([]);
      setNlpInput("");
      setAnalysis({ tags: [], smartTags: [] });
      setCoordinates(null);
      setLocationName("");
      setOnboardRequired(false);
      setAnalysisError(null);
    }
  }, [open, form]);

  // Check if user is onboarded when dialog opens
  useEffect(() => {
    if (open) {
      const checkOnboarding = async () => {
        try {
          const { data: { user } } = await supabase.auth.getUser();
          if (!user) return;

          const { data: profileRows } = await supabase
            .from('profiles')
            .select('stripe_account_id')
            .eq('user_id', user.id)
            .order('created_at', { ascending: true })
            .limit(1);

          const profile = (profileRows || [])[0];
          if (!profile?.stripe_account_id) {
            setOnboardRequired(true);
          }
        } catch (error) {
          console.error('Error checking onboarding status:', error);
        }
      };

      checkOnboarding();
    }
  }, [open]);

  const handleMapClick = useCallback((event: mapboxgl.MapMouseEvent) => {
    const [lng, lat] = event.lngLat.toArray();
    setCoordinates([lng, lat]);
    updateMarker([lng, lat]);
    // Reverse geocode to get address
    fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${process.env.NEXT_PUBLIC_MAPBOX_TOKEN}`)
      .then(response => response.json())
      .then(data => {
        const address = data.features[0]?.place_name;
        setLocationName(address || "");
        setValue("location", address || "");
      });
  }, [updateMarker, setCoordinates, setValue]);

  const handleGeolocation = () => {
    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { longitude, latitude } = position.coords;
        setCoordinates([longitude, latitude]);
        if (map) {
          map.flyTo({ center: [longitude, latitude], zoom: 15 });
          updateMarker([longitude, latitude]);
        }
        // Reverse geocode to get address
        fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${longitude},${latitude}.json?access_token=${process.env.NEXT_PUBLIC_MAPBOX_TOKEN}`)
          .then(response => response.json())
          .then(data => {
            const address = data.features[0]?.place_name;
            setLocationName(address || "");
            setValue("location", address || "");  
          })
          .finally(() => setIsLocating(false));
      },
      (error) => {
        console.error("Error getting location:", error);
        setIsLocating(false);
      }
    );
  };

  const handleImageChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files && files.length > 0) {
      const newFiles = Array.from(files);
      setImageFiles(prev => [...prev, ...newFiles]);
      
      // Create previews for new files
      newFiles.forEach(file => {
        const reader = new FileReader();
        reader.onloadend = () => {
          setImagePreviews(prev => [...prev, reader.result as string]);
        };
        reader.readAsDataURL(file);
      });
    }
  };

  const removeImage = (index: number) => {
    setImageFiles(prev => prev.filter((_, i) => i !== index));
    setImagePreviews(prev => prev.filter((_, i) => i !== index));
  };

  // Update the category selection
  const handleCategorySelect = (category: string) => {
    setSelectedCategory(category);
    setSelectedSubcategory("");
    setValue("category", category);
    setValue("subcategory", "");
    setSelectedTags([]);
    setOpenCategory(false);
  };

  // Update the subcategory selection
  const handleSubcategorySelect = (subcategory: string) => {
    setSelectedSubcategory(subcategory);
    setValue("subcategory", subcategory);
    setOpenSubcategory(false);
  };

  // Get the title and description values for real-time watching
  const title = watch("title");
  const description = watch("description");

  // Update the smart tags effect to use AI suggestions
  useEffect(() => {
    const content = `${title || ""} ${description || ""}`.toLowerCase().trim();
    
    if (selectedCategory && content.length >= 3) {
      const fetchAISuggestions = async () => {
        setIsLoadingTags(true);
        try {
          const headers = await withCsrfHeaders({
            'Content-Type': 'application/json'
          });
          
          const response = await fetch('/api/search', {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({ 
              title: title || "", 
              description: description || "",
              category: selectedCategory 
            })
          });
          
          const data = await response.json();
          
          if (!response.ok) {
            throw new Error(data.error || 'Failed to fetch suggestions');
          }
          
          if (data.suggestions) {
            setSuggestedTags(data.suggestions);
          }
        } catch (error) {
          console.error('Error getting AI tag suggestions:', error);
          // Fallback to basic tag matching if AI fails
          const categoryTags = Object.values(CATEGORY_STRUCTURE[selectedCategory as keyof typeof CATEGORY_STRUCTURE].tags)
            .flat()
            .filter(tag => {
              const words = content.split(/\s+/);
              return words.some(word => tag.toLowerCase().includes(word) || word.includes(tag.toLowerCase()));
            });
          setSuggestedTags(Array.from(new Set(categoryTags)));
        } finally {
          setIsLoadingTags(false);
        }
      };

      // Debounce the API call
      const timeoutId = setTimeout(() => {
        fetchAISuggestions();
      }, 500);

      return () => clearTimeout(timeoutId);
    } else {
      setSuggestedTags([]);
      setIsLoadingTags(false);
    }
  }, [title, description, selectedCategory]);

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) => {
      const newTags = prev.includes(tag)
        ? prev.filter((t) => t !== tag)
        : [...prev, tag];
      setValue("tags", newTags);
      return newTags;
    });
  };

  const onSubmit = async (data: FormValues) => {
    try {
      setIsSubmitting(true);
      setOnboardRequired(false); // Reset onboarding requirement
      console.log("Starting ad creation with form data:", { ...data, tags: selectedTags });
      
      // Validate required fields
      if (!selectedCategory) {
        throw new Error('Please select a category');
      }
      if (!selectedSubcategory) {
        throw new Error('Please select a subcategory');
      }
      
      const main_category = selectedCategory as 'Items' | 'Services'
      const sub_category = selectedSubcategory as 'Buy' | 'Sell' | 'Free' | 'I want' | 'I will' | 'I can'

      console.log("Creating listing with:", {
        title: data.title,
        description: data.description,
        main_category,
        sub_category,
        price: data.price,
        tags: selectedTags,
        coordinates: coordinates,
        address: locationName ? { label: locationName } : null,
      });

      const created = await createListing({
        title: data.title,
        description: data.description,
        main_category,
        sub_category,
        price: data.price,
        tags: selectedTags,
        coordinates: coordinates,
        address: locationName ? { label: locationName } : null,
      })
      
      console.log("Listing created successfully:", created);
      
      if (created?.id && imageFiles.length > 0) {
        console.log("Uploading images for listing:", created.id);
        await uploadListingImages(created.id, imageFiles)
        console.log("Images uploaded successfully");
      }
      
      console.log("Closing dialog and resetting form");
      onOpenChange?.(false);
      form.reset();
      setSelectedCategory("");
      setSelectedSubcategory("");
      setSelectedTags([]);
      setSuggestedTags([]);
      setImageFiles([]);
      setImagePreviews([]);
      console.log("Ad creation completed successfully");
      
    } catch (error) {
      console.error("Error creating ad:", error);
      const msg = error instanceof Error ? error.message : String(error)
      
      if (msg.includes('Seller not onboarded')) {
        setOnboardRequired(true)
        setAnalysisError('You need to complete Stripe onboarding to create listings. Click "Start Onboarding" above.');
        setTimeout(() => setAnalysisError(null), 8000);
      } else {
        // Show user-friendly error message
        setAnalysisError(`Failed to create ad: ${msg}`);
        setTimeout(() => setAnalysisError(null), 5000);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleNlpAnalysis = async () => {
    if (!nlpInput.trim()) {
      setAnalysisError("Please enter some text to analyze");
      setTimeout(() => setAnalysisError(null), 3000);
      return;
    }
    
    console.log("Analyzing input:", nlpInput);
    setIsAnalyzing(true);
    
    try {
      // Clear any previous analysis
      setAnalysis({ tags: [], smartTags: [] });
      
      // Call the Wit.ai service
      console.log("Calling witService.analyzeText with:", nlpInput);
      
      let result;
      try {
        result = await witService.analyzeText(nlpInput);
        console.log('Wit.ai analysis result:', result);
      } catch (apiError) {
        console.error('Error from Wit.ai service:', apiError);
        setAnalysisError("Failed to connect to Wit.ai service. Make sure your NEXT_PUBLIC_WIT_AI_TOKEN is set correctly in .env.local file.");
        setTimeout(() => setAnalysisError(null), 5000);
        setIsAnalyzing(false);
        return;
      }
      
      // Update form fields with the analysis results
      if (result.title) {
        console.log('Setting title:', result.title);
        setValue("title", result.title);
      }
      
      if (result.description) {
        console.log('Setting description:', result.description);
        setValue("description", result.description);
      }
      
      // Handle category first - make sure it's a valid category from CATEGORY_STRUCTURE
      if (result.category) {
        console.log('Setting category:', result.category);
        // Check if category is valid before setting it
        if (Object.keys(CATEGORY_STRUCTURE).includes(result.category)) {
          handleCategorySelect(result.category);
        } else {
          console.log(`AI suggested '${result.category}' but it's not available. Defaulting to 'Items'.`);
          handleCategorySelect('Items');
        }
      } else {
        // Default to Items category if none provided
        console.log('No category found, defaulting to Items');
        handleCategorySelect('Items');
      }
      
      // Now handle subcategory after category is set
      if (result.subcategory) {
        console.log('Setting subcategory:', result.subcategory);
        
        // Get the current selected category from form values to ensure it's the most up-to-date
        const category = getValues("category");
        
        if (!category) {
          console.error('No category set, defaulting to Items');
          handleCategorySelect('Items');
        }
        
        // Get valid subcategories for the selected category
        const validSubcategories = CATEGORY_STRUCTURE[category as keyof typeof CATEGORY_STRUCTURE]?.subcategories || [];
        
        // Check if subcategory is valid for the selected category
        if (validSubcategories.includes(result.subcategory)) {
          handleSubcategorySelect(result.subcategory);
        } else {
          console.error(`Invalid subcategory "${result.subcategory}" for category "${category}". Valid options are:`, validSubcategories);
          
          // Special handling for Services category
          if (category === 'Services') {
            // Map subcategory to a valid Services subcategory
            let mappedSubcategory = 'I want'; // Default
            
            if (result.subcategory === 'Buy' || result.subcategory.toLowerCase().includes('want') || 
                result.subcategory.toLowerCase().includes('need')) {
              mappedSubcategory = 'I want';
            } else if (result.subcategory === 'Sell' || result.subcategory.toLowerCase().includes('will') || 
                       result.subcategory.toLowerCase().includes('offer')) {
              mappedSubcategory = 'I will';
            } else if (result.subcategory.toLowerCase().includes('can') || 
                       result.subcategory.toLowerCase().includes('able')) {
              mappedSubcategory = 'I can';
            }
            
            console.log(`Mapping subcategory to valid Services subcategory: ${mappedSubcategory}`);
            handleSubcategorySelect(mappedSubcategory);
          } else {
            // For other categories, show a notification instead of alert
            setAnalysisError(`Invalid subcategory: ${result.subcategory}. Please select a valid subcategory for ${category}.`);
            setTimeout(() => setAnalysisError(null), 3000);
          }
        }
      }
      
      if (result.price) {
        console.log('Setting price:', result.price);
        setValue("price", result.price);
      }
      
      if (result.contactNumber) {
        console.log('Setting contact number:', result.contactNumber);
        setValue("contactNumber", result.contactNumber);
      }
      
      if (result.location) {
        console.log('Setting location:', result.location);
        setLocationName(result.location);
        setValue("location", result.location);
      }
      
      // Update both main category tags and smart tags
      console.log('Setting tags:', result.tags);
      console.log('Setting smartTags:', result.smartTags);
      
      // Store analysis results
      setAnalysis({
        tags: result.tags || [],
        smartTags: result.smartTags || []
      });
      
      // Combine all tags for the form value
      const allTags = [...(result.tags || []), ...(result.smartTags || [])];
      if (allTags.length > 0) {
        console.log('Setting selectedTags:', allTags);
        setSelectedTags(allTags);
        setValue("tags", allTags);
      }
      
      // Set success state for visual feedback (without requiring user interaction)
      setAnalysisSuccess(true);
      // Auto-hide the success message after 3 seconds
      setTimeout(() => {
        setAnalysisSuccess(false);
      }, 3000);
      
      console.log("Analysis complete! Form fields have been updated.");
      
    } catch (error) {
      console.error('Error analyzing text:', error);
      if (error instanceof Error) {
        setAnalysisError(`Failed to analyze text: ${error.message}`);
      } else {
        setAnalysisError('Failed to analyze text. Please try again.');
      }
      setTimeout(() => setAnalysisError(null), 3000);
    } finally {
      setIsAnalyzing(false);
    }
  };

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
              <AdBasicInfoForm register={register as any} errors={errors} />

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
                  onLocationNameChange={(name) => setLocationName(name)}
                  onToggleMap={() => setShowMap(!showMap)}
                  onUseCurrentLocation={handleGeolocation}
                />
              </div>

              <div>
                <Label className="text-base font-semibold text-blue-600 dark:text-blue-400">
                  {t('ad.images.upload','Upload Images')}
                </Label>
                <ImageUploader imagePreviews={imagePreviews} onRemove={removeImage} onChange={handleImageChange} />
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
                disabled={isSubmitting}
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
  );
}
