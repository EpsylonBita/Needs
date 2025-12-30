import { render, screen } from '@testing-library/react'
import React from 'react'
import { LocationPicker } from '@/components/features/ads/location-picker'

test('shows map and coordinates overlay when enabled', () => {
  render(
    <LocationPicker
      locationName={'Test Place'}
      showMap={true}
      coordinates={[10, 20]}
      isLocating={false}
      onLocationNameChange={() => {}}
      onToggleMap={() => {}}
      onUseCurrentLocation={() => {}}
    />
  )
  expect(screen.getByText(/Selected location:/i)).toBeInTheDocument()
  expect(screen.getByText(/Coordinates:/i)).toBeInTheDocument()
})