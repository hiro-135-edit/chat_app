# frozen_string_literal: true

require 'rails_helper'

RSpec.describe 'Room and message input/authorization', type: :request do
  let(:owner) { create_confirmed_user }
  let(:outsider) { create_confirmed_user }
  let(:room) { Room.create!(title: 'private ownership', user: owner) }
  let(:headers) { json_headers('X-User-Id' => owner.id.to_s) }

  it 'rejects a missing room author' do
    post '/api/rooms', params: { user_id: 0, title: 'room' }, headers:, as: :json
    expect(response).to have_http_status(:not_found)
  end
  [nil, '', ' '].each do |title|
    it "rejects empty room titles #{title.inspect}" do
      owner
      expect { post '/api/rooms', params: { user_id: owner.id, title: }, headers:, as: :json }.not_to change(Room, :count)
      expect(response).to have_http_status(:unprocessable_entity)
    end
  end
  it 'returns not_found for a nonexistent room' do
    get '/api/rooms/0', headers: headers
    expect(response).to have_http_status(:not_found)
    expect(response.parsed_body).to eq('error' => 'not_found')
  end
  [nil, '', '0', '-1'].each do |identity|
    it "requires a positive room deletion identity #{identity.inspect}" do
      delete "/api/rooms/#{room.id}", headers: json_headers('X-User-Id' => identity)
      expect(response).to have_http_status(:unauthorized)
      expect(Room.exists?(room.id)).to be(true)
    end
  end
  it 'prevents another user deleting the room or its messages' do
    message = room.messages.create!(body: 'retained', user: owner)
    delete "/api/rooms/#{room.id}", headers: json_headers('X-User-Id' => outsider.id.to_s)
    expect(response).to have_http_status(:forbidden)
    expect(Room.exists?(room.id)).to be(true)
    expect(Message.exists?(message.id)).to be(true)
  end
  it 'deletes owned rooms and messages without removing unrelated rooms' do
    message = room.messages.create!(body: 'removed', user: outsider)
    other = Room.create!(title: 'other', user: outsider)
    delete "/api/rooms/#{room.id}", headers: headers
    expect(response).to have_http_status(:ok)
    expect(response.parsed_body).to eq('ok' => true)
    expect(Message.exists?(message.id)).to be(false)
    expect(Room.exists?(other.id)).to be(true)
  end
  it 'rejects an unknown message author' do
    post "/api/rooms/#{room.id}/messages", params: { user_id: 0, body: 'hello' }, headers:, as: :json
    expect(response).to have_http_status(:unauthorized)
  end
  [nil, '', ' ', 'x' * 501].each do |body|
    it "does not persist invalid message input #{body.to_s.size} characters" do
      room
      expect do
        post "/api/rooms/#{room.id}/messages", params: { user_id: owner.id, body: }, headers:, as: :json
      end.not_to change(Message, :count)
      expect(response).to have_http_status(body.to_s.size > 500 ? :unprocessable_entity : :bad_request)
    end
  end
  [1, 500].each do |size|
    it "persists a message at length boundary #{size}" do
      post "/api/rooms/#{room.id}/messages", params: { user_id: owner.id, body: 'x' * size }, headers:, as: :json
      expect(response).to have_http_status(:created)
      expect(Message.find(response.parsed_body['id']).body.size).to eq(size)
    end
  end
end
