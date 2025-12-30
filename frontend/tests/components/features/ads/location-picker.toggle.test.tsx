import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { LocationPicker } from '@/components/features/ads/location-picker'

test('toggle map and use current location callbacks', async () => {
  const user = userEvent.setup()
  const onToggleMap = vi.fn()
  const onUseCurrentLocation = vi.fn()
  render(
    <LocationPicker
      locationName={''}
      showMap={false}
      coordinates={null}
      isLocating={false}
      onLocationNameChange={() => {}}
      onToggleMap={onToggleMap}
      onUseCurrentLocation={onUseCurrentLocation}
    />
  )
  const toggleBtn = screen.getByRole('button', { name: /Toggle map/i })
  await user.click(toggleBtn)
  expect(onToggleMap).toHaveBeenCalled()

  const useBtn = screen.getByRole('button', { name: /Use current location/i })
  await user.click(useBtn)
  expect(onUseCurrentLocation).toHaveBeenCalled()
})