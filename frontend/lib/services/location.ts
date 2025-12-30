/**
 * Location utility functions for distance calculations and geo queries
 */

/**
 * Calculate the distance between two coordinates using the Haversine formula
 */
export const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  // Convert coordinates to radians
  const toRad = (value: number): number => (value * Math.PI) / 180;
  const R = 6371; // Earth's radius in km

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  
  // Return distance in kilometers
  return R * c;
};

/**
 * Format a distance value to a human-readable string
 */
export const formatDistance = (distance: number): string => {
  if (distance < 1) {
    return `${Math.round(distance * 1000)}m away`;
  }
  return `${Math.round(distance)}km away`;
};

/**
 * Build a MongoDB geo query for location-based searches
 */
export const buildLocationQuery = (coordinates: [number, number], radius = 50): Record<string, unknown> => {
  if (!coordinates) return {};
  
  return {
    location: {
      $near: {
        $geometry: {
          type: "Point",
          coordinates // [longitude, latitude]
        },
        $maxDistance: radius * 1000 // Convert km to meters
      }
    }
  };
};

/**
 * Build a combined search query with optional text and location filters
 */
export const buildSearchQuery = (searchText: string, locationQuery: Record<string, unknown> = {}): Record<string, unknown> => {
  const query: Record<string, unknown> = {};
  
  // Add text search if searchText is provided
  if (searchText && searchText.trim()) {
    query.$text = { $search: searchText };
  }
  
  // Combine with location query if present
  return { ...query, ...locationQuery };
}; 
