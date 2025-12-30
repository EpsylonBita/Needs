import { render, screen } from '@testing-library/react'
import React from 'react'
import { LocationPicker } from '@/components/features/ads/location-picker'

test('geolocation button disabled while locating', () => {
  render(
    <LocationPicker
      locationName={''}
      showMap={false}
      coordinates={null}
      isLocating={true}
      onLocationNameChange={() => {}}
      onToggleMap={() => {}}
      onUseCurrentLocation={() => {}}
    />
  )
  const btn = screen.getByRole('button', { name: /Use current location/i })
  expect(btn).toBeDisabled()
})