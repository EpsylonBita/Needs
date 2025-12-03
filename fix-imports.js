const fs = require('fs');
const path = require('path');

console.log('Script starting...');

// Define import mappings
const importMappings = [
  { from: '@/lib/axios', to: '@/lib/api/axios' },
  { from: '@/lib/mock-backend', to: '@/lib/api/mock-backend' },
  { from: '@/lib/location', to: '@/lib/services/location' },
  { from: '@/lib/locationService', to: '@/lib/services/location-service' },
  { from: '@/lib/wit-service', to: '@/lib/services/wit-service' },
  { from: '@/lib/utils', to: '@/lib/utils/index' },
  { from: '@/lib/db', to: '@/lib/utils/db' },
];

// File extensions to process
const fileExtensions = ['.ts', '.tsx'];

// Helper function to escape special characters in RegExp
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Helper function to get all files recursively
function getAllFiles(dir) {
  let results = [];
  
  try {
    const list = fs.readdirSync(dir);
    
    list.forEach(file => {
      const filePath = path.join(dir, file);
      const stat = fs.statSync(filePath);
      
      if (stat && stat.isDirectory() && 
          !filePath.includes('node_modules') && 
          !filePath.includes('.next') && 
          !filePath.includes('.git')) {
        results = results.concat(getAllFiles(filePath));
      } else {
        results.push(filePath);
      }
    });
  } catch (error) {
    console.error(`Error reading directory ${dir}:`, error);
  }
  
  return results;
}

// Main function to update imports
function updateImports() {
  console.log('Updating imports for restructured lib directory...');
  
  // Get all TypeScript files
  const tsFiles = getAllFiles('.')
    .filter(file => fileExtensions.some(ext => file.endsWith(ext)))
    .filter(file => !file.includes('node_modules') && !file.includes('.next'));
  
  console.log(`Found ${tsFiles.length} TypeScript files to process`);
  
  let updatedFilesCount = 0;
  
  tsFiles.forEach(file => {
    try {
      const content = fs.readFileSync(file, 'utf8');
      let newContent = content;
      
      let hasChanges = false;
      importMappings.forEach(mapping => {
        const regex = new RegExp(`from\\s+['"]${escapeRegExp(mapping.from)}['"]`, 'g');
        if (regex.test(newContent)) {
          newContent = newContent.replace(regex, `from '${mapping.to}'`);
          hasChanges = true;
        }
      });
      
      if (hasChanges) {
        fs.writeFileSync(file, newContent, 'utf8');
        console.log(`Updated imports in: ${file}`);
        updatedFilesCount++;
      }
    } catch (error) {
      console.error(`Error updating imports in ${file}:`, error);
    }
  });
  
  console.log(`Updated imports in ${updatedFilesCount} files.`);
  return updatedFilesCount;
}

// Run the update
try {
  updateImports();
  console.log('Import paths updated successfully.');
} catch (error) {
  console.error('Error updating import paths:', error);
  process.exit(1);
} 