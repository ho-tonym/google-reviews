// Vive La Crepe NYC locations to track.
//
// `data_id` is Google Maps' internal identifier for a place. It is resolved
// automatically from `query` on the first run (when left null) and should then
// be pasted back here to avoid spending a SerpAPI credit on the lookup each run.
export const STORES = [
  {
    id: "columbus",
    label: "Columbus Ave",
    address: "532 Columbus Ave, New York, NY 10023",
    query: "Vive La Crepe 532 Columbus Ave New York NY 10023",
    data_id: "0x89c25884c329115f:0x51702dc281924a47",
  },
  {
    id: "hudson-yards",
    label: "Hudson Yards",
    address: "20 Hudson Yards 4th floor, New York, NY 10001",
    query: "Vive La Crepe 20 Hudson Yards New York NY 10001",
    data_id: "0x89c25983be7c5163:0x84de68a427aac1c5",
  },
  {
    id: "lexington",
    label: "Lexington Ave",
    address: "958 Lexington Ave #958B, New York, NY 10021",
    query: "Vive La Crepe 958 Lexington Ave New York NY 10021",
    data_id: "0x89c2594c261f50bf:0x84a25687c82a700c",
  },
];
