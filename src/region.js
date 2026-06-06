const LOCKED_REGION_KEY = 'locked_region'

export const getLockedRegion = () => localStorage.getItem(LOCKED_REGION_KEY) || ''

export const lockRegion = (region) => {
  if (region) localStorage.setItem(LOCKED_REGION_KEY, region)
}

export const clearLockedRegion = () => localStorage.removeItem(LOCKED_REGION_KEY)
