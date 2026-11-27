# frozen_string_literal: true

require 'rails_helper'

RSpec.describe 'BFF API contracts', type: :request do
  include ActiveSupport::Testing::TimeHelpers

  let(:user) { create_confirmed_user }
  let(:other_user) { create_confirmed_user }
  let(:room) { Room.create!(title: 'room', user: user) }
  let(:message) { room.messages.create!(body: 'original', user: user) }
  let(:headers) { json_headers('X-User-Id' => user.id.to_s) }
  let(:message_path) { "/api/rooms/#{room.id}/messages/#{message.id}" }

  def table_selects(&request)
    queries = []
    subscriber = lambda do |_name, _start, _finish, _id, payload|
      sql = payload[:sql]
      queries << sql if sql.match?(/\ASELECT/i) && payload[:name] != 'SCHEMA'
    end
    # Count actual SQL, including attempts that the query cache would otherwise hide.
    ActiveRecord::Base.uncached do
      ActiveSupport::Notifications.subscribed(subscriber, 'sql.active_record', &request)
    end
    queries
  end

  def message_attributes(record)
    {
      'id' => record.id, 'body' => record.body, 'room_id' => room.id, 'user_id' => user.id,
      'created_at' => record.created_at.as_json, 'edited_at' => record.edited_at.as_json,
      'user' => { 'id' => user.id, 'name' => user.name }
    }
  end

  describe 'shared BFF authentication' do
    [nil, 'wrong-token', ''].each do |token|
      it "rejects #{token.inspect} tokens on every protected controller before resource lookup" do
        invalid_headers = { 'X-BFF-Token' => token, 'Accept' => 'application/json' }.compact
        get '/api/rooms', headers: invalid_headers
        expect(response).to have_http_status(:unauthorized)
        expect(response.body).to be_empty

        get '/api/rooms/0/messages', headers: invalid_headers
        expect(response).to have_http_status(:unauthorized)

        patch '/api/users/0', params: { name: 'changed' }, headers: invalid_headers, as: :json
        expect(response).to have_http_status(:unauthorized)

        post '/api/auth/upsert', params: {}, headers: invalid_headers, as: :json
        expect(response).to have_http_status(:unauthorized)
      end
    end

    it 'rejects requests when the configured token is empty' do
      previous_token = ENV.fetch('BFF_SHARED_TOKEN')
      ENV['BFF_SHARED_TOKEN'] = ''
      get '/api/rooms', headers: { 'X-BFF-Token' => previous_token }
      expect(response).to have_http_status(:unauthorized)
    ensure
      ENV['BFF_SHARED_TOKEN'] = previous_token
    end

    it 'still allows credential login without the BFF token' do
      post '/api/auth/login', params: { email: user.email, password: 'Password1234' }, as: :json
      expect(response).to have_http_status(:ok)
      expect(response.parsed_body).to eq('id' => user.id, 'email' => user.email, 'name' => user.name)
    end

    it 'still allows registration without the BFF token' do
      post '/api/auth/signup', params: { name: 'new', email: 'new@example.com', password: 'Password1234' }, as: :json
      expect(response).to have_http_status(:ok)
      expect(response.parsed_body).to include('email' => 'new@example.com', 'name' => 'new')
    end

    it 'allows profile updates with a valid BFF token' do
      patch "/api/users/#{user.id}", params: { name: 'changed' }, headers: headers, as: :json
      expect(response).to have_http_status(:ok)
      expect(response.parsed_body).to eq('id' => user.id, 'email' => user.email, 'name' => 'changed')
    end

    it 'preserves OAuth creation and subsequent identity lookup responses' do
      allow(SecureRandom).to receive(:base58).with(16).and_return('StablePassword12')
      payload = { provider: 'google', providerSub: 'oauth-id', email: 'oauth@example.com', name: 'OAuth User' }
      post '/api/auth/upsert', params: payload, headers: headers, as: :json
      expect(response).to have_http_status(:created)
      result = response.parsed_body
      expect(result).to eq('railsUserId' => User.find_by!(email: 'oauth@example.com').id, 'railsUserName' => 'OAuth User')

      expect do
        post '/api/auth/upsert', params: payload, headers: headers, as: :json
      end.not_to change(Identity, :count)
      expect(response).to have_http_status(:ok)
      expect(response.parsed_body).to eq(result)
    end
  end

  describe 'room responses and eager loading' do
    it 'keeps the list/detail fields, user and formatted creation time' do
      room
      get '/api/rooms', headers: headers
      expect(response).to have_http_status(:ok)
      list_item = response.parsed_body.find { |item| item['id'] == room.id }
      expect(list_item).to eq(
        'id' => room.id, 'title' => room.title, 'user_id' => user.id,
        'created_at' => room.created_at.as_json, 'created_at_text' => room.created_at_text,
        'user' => { 'id' => user.id, 'name' => user.name }
      )
      get "/api/rooms/#{room.id}", headers: headers
      expect(response.parsed_body).to eq(list_item)
    end

    it 'keeps creation responses smaller than list responses' do
      post '/api/rooms', params: { title: 'new', user_id: user.id }, headers: headers, as: :json
      expect(response).to have_http_status(:created)
      expect(response.parsed_body.keys).to contain_exactly('id', 'title', 'user_id', 'created_at')
    end

    it 'loads authors in one SELECT for multiple rooms' do
      room
      Room.create!(title: 'other room', user: other_user)
      request_headers = headers
      queries = table_selects { get '/api/rooms', headers: request_headers }
      expect(response).to have_http_status(:ok)
      expect(queries.count { |sql| sql.include?('FROM "users"') }).to eq(1)
    end
  end

  describe 'message responses and eager loading' do
    it 'keeps list/detail fields and author data' do
      message
      get "/api/rooms/#{room.id}/messages", headers: headers
      expect(response).to have_http_status(:ok)
      expect(response.parsed_body).to eq([message_attributes(message)])
      get message_path, headers: headers
      expect(response.parsed_body).to eq(message_attributes(message))
    end

    it 'preserves untrimmed message creation' do
      post "/api/rooms/#{room.id}/messages", params: { body: ' hello ', user_id: user.id }, headers: headers, as: :json
      expect(response).to have_http_status(:created)
      expect(response.parsed_body).to eq(message_attributes(room.messages.last))
      expect(response.parsed_body['body']).to eq(' hello ')
    end

    it 'loads authors in one SELECT for multiple messages' do
      message
      room.messages.create!(body: 'other', user: other_user)
      path = "/api/rooms/#{room.id}/messages"
      request_headers = headers
      queries = table_selects { get path, headers: request_headers }
      expect(response).to have_http_status(:ok)
      expect(queries.count { |sql| sql.include?('FROM "users"') }).to eq(1)
    end
  end

  describe 'message editing' do
    it 'trims the body, marks the edit time and preserves response fields' do
      freeze_time do
        patch message_path, params: { body: ' changed ' }, headers: headers, as: :json
        expect(response).to have_http_status(:ok)
        expect(message.reload.body).to eq('changed')
        expect(message.edited_at).to eq(Time.current)
        expect(response.parsed_body).to eq(message_attributes(message))
      end
    end

    it 'allows the exact one-hour boundary' do
      freeze_time do
        message.update!(created_at: 1.hour.ago)
        patch message_path, params: { body: 'changed' }, headers: headers, as: :json
        expect(response).to have_http_status(:ok)
      end
    end

    it 'rejects expired edits without changing the message' do
      freeze_time do
        message.update!(created_at: 1.hour.ago - 1.second)
        patch message_path, params: { body: 'changed' }, headers: headers, as: :json
        expect(response).to have_http_status(:forbidden)
        expect(response.parsed_body).to eq('error' => 'edit_window_expired')
        expect(message.reload.body).to eq('original')
      end
    end

    it 'checks empty text before the edit deadline' do
      message.update!(created_at: 2.hours.ago)
      patch message_path, params: { body: '   ' }, headers: headers, as: :json
      expect(response).to have_http_status(:bad_request)
      expect(response.parsed_body).to eq('error' => 'missing_body')
    end

    it 'preserves validation errors and the original message' do
      patch message_path, params: { body: 'x' * 501 }, headers: headers, as: :json
      expect(response).to have_http_status(:unprocessable_entity)
      expect(response.parsed_body['errors']).not_to be_empty
      expect(message.reload.body).to eq('original')
    end
  end

  %i[patch delete].each do |verb|
    describe "#{verb} message authorization and lookup" do
      it 'checks room existence before requester identity' do
        public_send(verb, '/api/rooms/0/messages/0', params: { body: '' }, headers: json_headers, as: :json)
        expect(response).to have_http_status(:not_found)
        expect(response.parsed_body).to eq('error' => 'room_not_found')
      end

      it 'checks message existence before requester identity' do
        public_send(verb, "/api/rooms/#{room.id}/messages/0", params: { body: '' }, headers: json_headers, as: :json)
        expect(response).to have_http_status(:not_found)
        expect(response.parsed_body).to eq('error' => 'message_not_found')
      end

      it 'rejects a missing requester' do
        public_send(verb, message_path, params: { body: '' }, headers: json_headers, as: :json)
        expect(response).to have_http_status(:unauthorized)
        expect(response.parsed_body).to eq('error' => 'unauthorized')
      end

      it 'checks ownership before body validation' do
        request_headers = json_headers('X-User-Id' => other_user.id.to_s)
        public_send(verb, message_path, params: { body: '' }, headers: request_headers, as: :json)
        expect(response).to have_http_status(:forbidden)
        expect(response.parsed_body).to eq('error' => 'forbidden')
        expect(message.reload.body).to eq('original')
      end

      it 'does not fetch a message through another room' do
        another_room = Room.create!(title: 'another', user: user)
        path = "/api/rooms/#{another_room.id}/messages/#{message.id}"
        public_send(verb, path, params: { body: 'changed' }, headers: headers, as: :json)
        expect(response).to have_http_status(:not_found)
        expect(response.parsed_body).to eq('error' => 'message_not_found')
      end

      it 'loads the room and message only once', :query_efficiency do
        path = message_path
        request_headers = headers
        queries = table_selects do
          public_send(verb, path, params: { body: 'changed' }, headers: request_headers, as: :json)
        end
        expect(response).to have_http_status(verb == :patch ? :ok : :no_content)
        expect(queries.count { |sql| sql.include?('FROM "rooms"') }).to eq(1)
        expect(queries.count { |sql| sql.include?('FROM "messages"') }).to eq(1)
      end
    end
  end

  it 'deletes an owned message after the edit window, returning an empty 204' do
    message.update!(created_at: 2.hours.ago)
    path = message_path
    expect { delete path, headers: headers }.to change(Message, :count).by(-1)
    expect(response).to have_http_status(:no_content)
    expect(response.body).to be_empty
  end
end
