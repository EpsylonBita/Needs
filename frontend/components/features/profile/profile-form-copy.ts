export const profilePhotoTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

export const profileFormCopy = {
  en: {
    edit: 'Edit Profile', description: 'Your name and email are required. Everything else is optional.',
    fullName: 'Full Name', email: 'Email', title: 'Professional Title', location: 'Location', bio: 'Bio', optional: 'optional',
    emailHint: 'A new email address must be confirmed before it replaces your current one.',
    photo: 'Profile Photo', uploadAvatar: 'Upload profile photo', uploadCover: 'Upload cover photo',
    avatarTitle: 'Update profile photo', coverTitle: 'Update cover image', preview: 'Selected image preview',
    chooseImage: 'Choose an image or drop it here', imageHint: 'JPG, PNG, WebP or GIF, up to 5 MB.', removeSelection: 'Remove selected image',
    invalidImage: 'Choose a JPG, PNG, WebP or GIF image up to 5 MB.', imageReadError: 'This image could not be opened. Please choose another file.',
    cancel: 'Cancel', close: 'Close', save: 'Save Changes', saving: 'Saving…',
    saved: 'Profile updated', savedDescription: 'Your changes have been saved.',
    pendingEmail: 'Profile saved. Check your email to confirm the new address.',
    partialSave: 'Your profile was saved, but the email change failed. Please try changing your email again.',
    saveError: 'Your profile could not be saved. Please try again.', photoError: 'The photo could not be saved to your profile. Please try again.',
    signIn: 'Please sign in again to save your changes.',
    sessionChanged: 'Your account changed. Close this form and open it again before saving.',
    nameError: 'Enter a name with 2–100 characters.', emailError: 'Enter a valid email address, up to 254 characters.',
    titleError: 'Keep your title to 100 characters or fewer.', locationError: 'Keep your location to 160 characters or fewer.', bioError: 'Keep your bio to 1,000 characters or fewer.',
  },
  el: {
    edit: 'Επεξεργασία προφίλ', description: 'Το όνομα και το email είναι υποχρεωτικά. Τα υπόλοιπα πεδία είναι προαιρετικά.',
    fullName: 'Ονοματεπώνυμο', email: 'Email', title: 'Επαγγελματικός τίτλος', location: 'Τοποθεσία', bio: 'Λίγα λόγια για εσένα', optional: 'προαιρετικό',
    emailHint: 'Μια νέα διεύθυνση email χρειάζεται επιβεβαίωση πριν αντικαταστήσει την τρέχουσα.',
    photo: 'Φωτογραφία προφίλ', uploadAvatar: 'Ανέβασμα φωτογραφίας προφίλ', uploadCover: 'Ανέβασμα εικόνας εξωφύλλου',
    avatarTitle: 'Αλλαγή φωτογραφίας προφίλ', coverTitle: 'Αλλαγή εικόνας εξωφύλλου', preview: 'Προεπισκόπηση επιλεγμένης εικόνας',
    chooseImage: 'Επίλεξε μια εικόνα ή σύρε την εδώ', imageHint: 'JPG, PNG, WebP ή GIF, έως 5 MB.', removeSelection: 'Αφαίρεση επιλεγμένης εικόνας',
    invalidImage: 'Επίλεξε εικόνα JPG, PNG, WebP ή GIF έως 5 MB.', imageReadError: 'Δεν ήταν δυνατό το άνοιγμα της εικόνας. Επίλεξε άλλο αρχείο.',
    cancel: 'Ακύρωση', close: 'Κλείσιμο', save: 'Αποθήκευση αλλαγών', saving: 'Αποθήκευση…',
    saved: 'Το προφίλ ενημερώθηκε', savedDescription: 'Οι αλλαγές σου αποθηκεύτηκαν.',
    pendingEmail: 'Το προφίλ αποθηκεύτηκε. Έλεγξε το email σου για να επιβεβαιώσεις τη νέα διεύθυνση.',
    partialSave: 'Το προφίλ αποθηκεύτηκε, αλλά η αλλαγή email απέτυχε. Δοκίμασε ξανά την αλλαγή email.',
    saveError: 'Δεν ήταν δυνατή η αποθήκευση του προφίλ. Δοκίμασε ξανά.', photoError: 'Δεν ήταν δυνατή η αποθήκευση της φωτογραφίας στο προφίλ σου. Δοκίμασε ξανά.',
    signIn: 'Συνδέσου ξανά για να αποθηκεύσεις τις αλλαγές σου.',
    sessionChanged: 'Ο λογαριασμός άλλαξε. Κλείσε τη φόρμα και άνοιξέ την ξανά πριν αποθηκεύσεις.',
    nameError: 'Γράψε ένα όνομα με 2–100 χαρακτήρες.', emailError: 'Γράψε ένα έγκυρο email έως 254 χαρακτήρες.',
    titleError: 'Ο τίτλος μπορεί να έχει έως 100 χαρακτήρες.', locationError: 'Η τοποθεσία μπορεί να έχει έως 160 χαρακτήρες.', bioError: 'Το βιογραφικό μπορεί να έχει έως 1.000 χαρακτήρες.',
  },
}

export function profileFormError(failure: unknown, locale: string, fallback: string): string {
  const copy = profileFormCopy[locale === 'el' ? 'el' : 'en']
  const message = failure instanceof Error ? failure.message : ''
  if (/session changed/i.test(message)) return copy.sessionChanged
  if (message.startsWith('Profile saved, but')) return copy.partialSave
  if (/not authenticated|session.*expired/i.test(message)) return copy.signIn
  return locale === 'el' || !message ? fallback : message
}
