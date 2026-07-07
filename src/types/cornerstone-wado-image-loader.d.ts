// cornerstone-wado-image-loader ships no types; this covers only the surface
// DicomViewer.tsx actually uses (external wiring + wadouri file manager).
declare module 'cornerstone-wado-image-loader/dist/cornerstoneWADOImageLoaderNoWebWorkers.bundle.min.js' {
  import type * as cornerstoneCoreType from 'cornerstone-core';
  import type * as dicomParserType from 'dicom-parser';

  interface FileManager {
    add(file: Blob): string;
    remove(imageId: string): void;
  }

  interface WadouriNamespace {
    fileManager: FileManager;
    dataSetCacheManager: {
      unload(imageId: string): void;
    };
  }

  const cornerstoneWADOImageLoader: {
    external: {
      cornerstone: typeof cornerstoneCoreType;
      dicomParser: typeof dicomParserType;
    };
    wadouri: WadouriNamespace;
  };

  export default cornerstoneWADOImageLoader;
}
