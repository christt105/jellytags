export type MediaItem = {
    Id: string;
    Name?: string;
    Type?: string;
    Tags?: string[];
    Genres?: string[];
    DateCreated?: string;
    OfficialRating?: string | null;
    CustomRating?: string | null;
    ImageTags?: { Primary?: string };
    SourceLibraryId?: string;
    SourceLibraryName?: string;
};
