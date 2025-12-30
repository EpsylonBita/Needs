"use client";

import { useEffect, useReducer, useRef } from 'react';

import { zodResolver } from '@hookform/resolvers/zod';
import { 
  ChevronDownIcon, 
  Loader2Icon, 
  XIcon 
} from "lucide-react";
import { useForm } from 'react-hook-form';

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { useAuth } from '@/contexts/auth-context';
import { registerSchema, type RegisterInput } from '@/lib/validations/auth';

/**
 * Country code interface for phone number prefixes
 */
interface CountryCode {
  /** Two-letter country code */
  code: string;
  /** Phone number prefix with + symbol */
  prefix: string;
  /** Country name */
  name: string;
}

// Comprehensive list of country codes
const countryCodes: CountryCode[] = [
  { code: "AL", prefix: "+355", name: "Albania" },
  { code: "AT", prefix: "+43", name: "Austria" },
  { code: "BE", prefix: "+32", name: "Belgium" },
  { code: "BG", prefix: "+359", name: "Bulgaria" },
  { code: "HR", prefix: "+385", name: "Croatia" },
  { code: "CY", prefix: "+357", name: "Cyprus" },
  { code: "CZ", prefix: "+420", name: "Czech Republic" },
  { code: "DK", prefix: "+45", name: "Denmark" },
  { code: "EE", prefix: "+372", name: "Estonia" },
  { code: "FI", prefix: "+358", name: "Finland" },
  { code: "FR", prefix: "+33", name: "France" },
  { code: "DE", prefix: "+49", name: "Germany" },
  { code: "GR", prefix: "+30", name: "Greece" },
  { code: "HU", prefix: "+36", name: "Hungary" },
  { code: "IS", prefix: "+354", name: "Iceland" },
  { code: "IE", prefix: "+353", name: "Ireland" },
  { code: "IT", prefix: "+39", name: "Italy" },
  { code: "LV", prefix: "+371", name: "Latvia" },
  { code: "LT", prefix: "+370", name: "Lithuania" },
  { code: "LU", prefix: "+352", name: "Luxembourg" },
  { code: "MT", prefix: "+356", name: "Malta" },
  { code: "NL", prefix: "+31", name: "Netherlands" },
  { code: "NO", prefix: "+47", name: "Norway" },
  { code: "PL", prefix: "+48", name: "Poland" },
  { code: "PT", prefix: "+351", name: "Portugal" },
  { code: "RO", prefix: "+40", name: "Romania" },
  { code: "RS", prefix: "+381", name: "Serbia" },
  { code: "SK", prefix: "+421", name: "Slovakia" },
  { code: "SI", prefix: "+386", name: "Slovenia" },
  { code: "ES", prefix: "+34", name: "Spain" },
  { code: "SE", prefix: "+46", name: "Sweden" },
  { code: "CH", prefix: "+41", name: "Switzerland" },
  { code: "GB", prefix: "+44", name: "United Kingdom" },
  { code: "US", prefix: "+1", name: "United States" },
  { code: "CA", prefix: "+1", name: "Canada" },
  { code: "MX", prefix: "+52", name: "Mexico" },
  { code: "CN", prefix: "+86", name: "China" },
  { code: "HK", prefix: "+852", name: "Hong Kong" },
  { code: "IN", prefix: "+91", name: "India" },
  { code: "ID", prefix: "+62", name: "Indonesia" },
  { code: "JP", prefix: "+81", name: "Japan" },
  { code: "MY", prefix: "+60", name: "Malaysia" },
  { code: "SG", prefix: "+65", name: "Singapore" },
  { code: "KR", prefix: "+82", name: "South Korea" },
  { code: "TW", prefix: "+886", name: "Taiwan" },
  { code: "TH", prefix: "+66", name: "Thailand" },
  { code: "VN", prefix: "+84", name: "Vietnam" },
  { code: "AU", prefix: "+61", name: "Australia" },
  { code: "NZ", prefix: "+64", name: "New Zealand" },
].sort((a, b) => a.name.localeCompare(b.name));

/**
 * Register form props interface
 */
export interface RegisterFormProps {
  /** Controls visibility of the registration modal */
  isOpen: boolean;
  /** Handler to close the registration modal */
  onClose: () => void;
  /** Optional handler to switch back to login form */
  onBackToLogin?: () => void;
  /** Optional title for the register dialog */
  title?: string;
}

/**
 * Register error type for better error handling
 */
type RegisterError = {
  message: string;
  field?: keyof RegisterInput;
};

/**
 * Define state interface for the reducer
 */
interface RegisterFormState {
  isMounted: boolean;
  selectedCountry: CountryCode;
  isDropdownOpen: boolean;
  isLoading: boolean;
  registerError: RegisterError | null;
}

/**
 * Define the actions for the reducer
 */
type RegisterFormAction =
  | { type: 'MOUNT' }
  | { type: 'SET_COUNTRY'; payload: CountryCode }
  | { type: 'TOGGLE_DROPDOWN'; payload?: boolean }
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_ERROR'; payload: RegisterError | null }
  | { type: 'RESET' };

/**
 * Reducer function for register form state
 */
function registerFormReducer(state: RegisterFormState, action: RegisterFormAction): RegisterFormState {
  switch (action.type) {
    case 'MOUNT':
      return { ...state, isMounted: true };
    case 'SET_COUNTRY':
      return { ...state, selectedCountry: action.payload };
    case 'TOGGLE_DROPDOWN':
      return { ...state, isDropdownOpen: action.payload !== undefined ? action.payload : !state.isDropdownOpen };
    case 'SET_LOADING':
      return { ...state, isLoading: action.payload };
    case 'SET_ERROR':
      return { ...state, registerError: action.payload };
    case 'RESET':
      return { ...initialRegisterFormState };
    default:
      return state;
  }
}

/**
 * Initial state for the register form
 */
const initialRegisterFormState: RegisterFormState = {
  isMounted: false,
  selectedCountry: countryCodes.find((c) => c.code === "GR") || countryCodes[0],
  isDropdownOpen: false,
  isLoading: false,
  registerError: null
};

/**
 * RegisterForm Component
 * 
 * Provides new user registration functionality with form validation
 * and comprehensive error handling.
 */
export function RegisterForm({ 
  isOpen: _isOpen, 
  onClose,
  onBackToLogin: _onBackToLogin,
  title = "Create Account"
}: RegisterFormProps) {
  const [state, dispatch] = useReducer(registerFormReducer, initialRegisterFormState);
  const { isMounted, selectedCountry, isDropdownOpen, isLoading, registerError: _registerError } = state;
  
  const phoneInputRef = useRef<HTMLInputElement>(null);
  const { register: signUp } = useAuth();
  const { toast } = useToast();

  useEffect(() => {
    dispatch({ type: 'MOUNT' });
  }, []);

  const {
    register,
    handleSubmit,
    formState: { errors },
    watch,
    setValue,
  } = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      fullName: '',
      email: '',
      phoneNumber: selectedCountry.prefix,
      password: '',
      confirmPassword: '',
    },
  });

  const _handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let value = e.target.value;
    value = value.replace(selectedCountry.prefix, "");
    const numberOnly = value.replace(/[^\d]/g, "");
    setValue('phoneNumber', selectedCountry.prefix + numberOnly);
  };

  const handleCountrySelect = (country: CountryCode) => {
    dispatch({ type: 'SET_COUNTRY', payload: country });
    const phoneNumber = watch('phoneNumber').replace(/^\+\d+/, '');
    setValue('phoneNumber', country.prefix + phoneNumber);
    dispatch({ type: 'TOGGLE_DROPDOWN', payload: false });
    if (phoneInputRef.current) {
      phoneInputRef.current.focus();
    }
  };

  const onSubmit = async (data: RegisterInput) => {
    try {
      dispatch({ type: 'SET_LOADING', payload: true });
      await signUp(data);
      toast({
        title: "Success",
        description: "Your account has been created.",
      });
      onClose();
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Something went wrong",
        variant: "destructive",
      });
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false });
    }
  };

  // Prevent hydration issues by not rendering until mounted
  if (!isMounted) return null;
  if (!_isOpen) return null;

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-background rounded-lg shadow-lg w-full max-w-md p-6 space-y-6">
        <h2 className="text-2xl font-bold text-center">{title}</h2>
        
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="fullName">Full Name</Label>
            <Input
              id="fullName"
              type="text"
              placeholder="John Doe"
              {...register('fullName')}
              className={errors.fullName ? 'border-destructive' : ''}
            />
            {errors.fullName && (
              <p className="text-sm text-destructive">{errors.fullName.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="john@example.com"
              {...register('email')}
              className={errors.email ? 'border-destructive' : ''}
            />
            {errors.email && (
              <p className="text-sm text-destructive">{errors.email.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="phoneNumber">Phone Number</Label>
            <div className="relative">
              <Input
                id="phoneNumber"
                type="tel"
                {...register('phoneNumber', {
                  onChange: (e) => {
                    let value = e.target.value;
                    value = value.replace(selectedCountry.prefix, "");
                    const numberOnly = value.replace(/[^\d]/g, "");
                    setValue('phoneNumber', selectedCountry.prefix + numberOnly);
                  }
                })}
                className={errors.phoneNumber ? 'border-destructive pl-24' : 'pl-24'}
              />
              <button
                type="button"
                onClick={() => dispatch({ type: 'TOGGLE_DROPDOWN', payload: true })}
                className="absolute left-2 top-1/2 -translate-y-1/2 flex items-center gap-1 text-sm"
              >
                {selectedCountry.code} <ChevronDownIcon className="h-4 w-4" />
              </button>
              {isDropdownOpen && (
                <div className="absolute z-10 w-full max-h-60 overflow-auto bg-background border rounded-md shadow-lg mt-1">
                  {countryCodes.map((country) => (
                    <button
                      key={country.code}
                      type="button"
                      onClick={() => handleCountrySelect(country)}
                      className="w-full px-4 py-2 text-left hover:bg-accent flex items-center gap-2"
                    >
                      <span>{country.code}</span>
                      <span className="text-muted-foreground">{country.name}</span>
                      <span className="ml-auto">{country.prefix}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {errors.phoneNumber && (
              <p className="text-sm text-destructive">{errors.phoneNumber.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              {...register('password')}
              className={errors.password ? 'border-destructive' : ''}
            />
            {errors.password && (
              <p className="text-sm text-destructive">{errors.password.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirmPassword">Confirm Password</Label>
            <Input
              id="confirmPassword"
              type="password"
              {...register('confirmPassword')}
              className={errors.confirmPassword ? 'border-destructive' : ''}
            />
            {errors.confirmPassword && (
              <p className="text-sm text-destructive">{errors.confirmPassword.message}</p>
            )}
          </div>

          <Button type="submit" className="w-full" disabled={isLoading}>
            {isLoading ? (
              <>
                <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />
                Creating account...
              </>
            ) : (
              'Create Account'
            )}
          </Button>
        </form>

        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-muted-foreground hover:text-foreground"
        >
          <XIcon className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </button>
      </div>
    </div>
  );
}
