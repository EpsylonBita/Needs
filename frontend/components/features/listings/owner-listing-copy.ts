export const ownerListingCopy = {
  el: {
    title: 'Οι αγγελίες μου', subtitle: 'Δες, ενημέρωσε και διαχειρίσου τις αγγελίες σου.', back: 'Πίσω στο προφίλ', backToList: 'Πίσω στις αγγελίες μου',
    all: 'Όλες', active: 'Ενεργές', paused: 'Σε παύση', sold: 'Ολοκληρωμένες', held: 'Σε έλεγχο', filter: 'Φίλτρο κατάστασης',
    activeStatus: 'Ενεργή', pausedStatus: 'Σε παύση', soldStatus: 'Ολοκληρωμένη', heldStatus: 'Σε έλεγχο',
    loading: 'Φόρτωση αγγελιών…', loadError: 'Δεν ήταν δυνατή η φόρτωση των αγγελιών σου.', retry: 'Δοκίμασε ξανά', refresh: 'Ανανέωση',
    empty: 'Δεν έχεις αγγελίες ακόμη', emptyHint: 'Δημιούργησε μια αγγελία για κάτι που χρειάζεσαι ή προσφέρεις.', noResults: 'Δεν υπάρχουν αγγελίες με αυτό το φίλτρο.',
    view: 'Προβολή', edit: 'Επεξεργασία', photos: 'Φωτογραφίες', pause: 'Παύση', activate: 'Ενεργοποίηση', complete: 'Ολοκλήρωση', remove: 'Διαγραφή',
    holdNotice: 'Η αγγελία βρίσκεται σε έλεγχο. Η επεξεργασία των στοιχείων δεν αίρει την αναστολή· η επανενεργοποίηση γίνεται από διαχειριστή.',
    actionError: 'Η αλλαγή δεν αποθηκεύτηκε. Ανανέωσε τη λίστα και δοκίμασε ξανά.',
    deleteError: 'Η αγγελία δεν διαγράφηκε. Αν συνδέεται με συναλλαγές ή αξιολογήσεις, χρησιμοποίησε την Παύση για να διατηρηθεί το ιστορικό.',
    deleteTitle: 'Διαγραφή αγγελίας;', deleteHint: 'Η διαγραφή είναι οριστική. Για να την κρύψεις προσωρινά, επίλεξε Παύση. Αγγελίες με ιστορικό συναλλαγών ή αξιολογήσεων δεν διαγράφονται.',
    cancel: 'Ακύρωση', deleting: 'Διαγραφή…', saved: 'Η κατάσταση ενημερώθηκε.', deleted: 'Η αγγελία διαγράφηκε.',
    unavailable: 'Η αγγελία δεν βρέθηκε ή δεν ανήκει στον λογαριασμό σου.', ownerPreview: 'Προεπισκόπηση ιδιοκτήτη', publicView: 'Δημόσια προβολή',
    privateNote: 'Η αγγελία δεν είναι δημόσια διαθέσιμη αυτή τη στιγμή. Μπορείς να δεις τα αποθηκευμένα στοιχεία της εδώ.',
    description: 'Περιγραφή', location: 'Τοποθεσία', contact: 'Τηλέφωνο επικοινωνίας', tags: 'Ετικέτες', noLocation: 'Δεν έχει οριστεί τοποθεσία', noPhotos: 'Δεν υπάρχουν φωτογραφίες',
    free: 'Δωρεάν', items: 'Αντικείμενα', services: 'Υπηρεσίες', Buy: 'Ζητάω να αγοράσω', Sell: 'Προσφέρω για πώληση', Free: 'Χαρίζω', 'I want': 'Ζητάω υπηρεσία', 'I will': 'Προσφέρω υπηρεσία', 'I can': 'Μπορώ να βοηθήσω',
  },
  en: {
    title: 'My listings', subtitle: 'View, update and manage your listings.', back: 'Back to profile', backToList: 'Back to my listings',
    all: 'All', active: 'Active', paused: 'Paused', sold: 'Completed', held: 'Under review', filter: 'Filter by status',
    activeStatus: 'Active', pausedStatus: 'Paused', soldStatus: 'Completed', heldStatus: 'Under review',
    loading: 'Loading listings…', loadError: 'Your listings could not be loaded.', retry: 'Try again', refresh: 'Refresh',
    empty: 'No listings yet', emptyHint: 'Create a listing for something you need or have to offer.', noResults: 'No listings match this filter.',
    view: 'View', edit: 'Edit', photos: 'Photos', pause: 'Pause', activate: 'Activate', complete: 'Complete', remove: 'Delete',
    holdNotice: 'This listing is under review. Editing its details does not lift the suspension; an administrator must release it.',
    actionError: 'The change was not saved. Refresh your listings and try again.',
    deleteError: 'The listing could not be deleted. If it has transactions or reviews, use Pause to preserve its history.',
    deleteTitle: 'Delete this listing?', deleteHint: 'Deletion is permanent. Use Pause to hide it temporarily. Listings with transaction or review history cannot be deleted.',
    cancel: 'Cancel', deleting: 'Deleting…', saved: 'Listing status updated.', deleted: 'Listing deleted.',
    unavailable: 'The listing was not found or does not belong to your account.', ownerPreview: 'Owner preview', publicView: 'Public view',
    privateNote: 'This listing is not publicly available right now. You can view its saved details here.',
    description: 'Description', location: 'Location', contact: 'Contact number', tags: 'Tags', noLocation: 'No location set', noPhotos: 'No photos yet',
    free: 'Free', items: 'Items', services: 'Services', Buy: 'Looking to buy', Sell: 'For sale', Free: 'Giving away', 'I want': 'Requesting a service', 'I will': 'Offering a service', 'I can': 'Available to help',
  },
}
export type OwnerListingCopy = typeof ownerListingCopy.en
export function ownerStatus(listing: { status: string; moderation_suspended: boolean }) {
  return listing.moderation_suspended ? 'held' : listing.status === 'suspended' ? 'paused' : listing.status === 'sold' ? 'sold' : 'active'
}
export function statusLabel(listing: { status: string; moderation_suspended: boolean }, copy: OwnerListingCopy) {
  const status = ownerStatus(listing)
  return status === 'held' ? copy.heldStatus : status === 'paused' ? copy.pausedStatus : status === 'sold' ? copy.soldStatus : copy.activeStatus
}
