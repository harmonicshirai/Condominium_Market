import { useEffect, useState } from 'react';
import type { Listing, MyConditions } from '../types';
import { DEFAULT_CONDITIONS, readConditions, readListings, saveConditions, saveListings } from './storage';

export function useListings() {
  const [listings, setListings] = useState<Listing[]>(() => readListings().listings);
  const [conditions, setConditionsState] = useState<MyConditions>(() => readConditions());
  const [storageError, setStorageError] = useState(false);

  useEffect(() => {
    setStorageError(!saveListings(listings));
  }, [listings]);

  useEffect(() => {
    setStorageError(!saveConditions(conditions));
  }, [conditions]);

  function upsertListing(listing: Listing): void {
    setListings((current) => {
      const found = current.some((item) => item.id === listing.id);
      return found ? current.map((item) => item.id === listing.id ? listing : item) : [listing, ...current];
    });
  }

  function removeListing(id: string): void {
    setListings((current) => current.filter((item) => item.id !== id));
  }

  function setConditions(value: MyConditions): void {
    setConditionsState(value);
  }

  function resetConditions(): void {
    setConditionsState(DEFAULT_CONDITIONS);
  }

  return { listings, conditions, storageError, upsertListing, removeListing, setConditions, resetConditions, setListings };
}
